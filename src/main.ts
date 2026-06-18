import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  BodyTransform,
  ProjectContext,
  RobotYamlConfig,
  SimConfig,
  SyncBundle,
  WorkerToMainMessage,
  WorldYamlConfig,
} from './types';
import { DEFAULT_PROJECT_CONTEXT, DEFAULT_SIM_CONFIG } from './types';
import { DEFAULT_DIFF_DRIVE_URDF } from './default-urdf';
import {
  resolveSpawnConfig,
  spawnToTransform,
} from './sim-config';
import {
  applyEnvVisualSettings,
  buildEnvVisuals,
  buildLegacyEnvVisuals,
  type EnvVisualBuildResult,
} from './world-visuals';
import {
  GitHubSync,
  LocalFolderSync,
  parseGitHubRepo,
  pickProjectFolder,
} from './github-sync';
import {
  fetchExamplesManifestFromGitHub,
  readExamplesManifestFromHandle,
  parseExamplesManifest,
  type ExampleEntry,
} from './examples-manifest';
import { normalizeProjectRoot } from './project-path';
import { parseUrdf } from './urdf-parser';
import { buildVisualsFromUrdf, disposeRobotVisuals } from './urdf-visuals';
import { loadBundledSimulation } from './bundled-sync';
import { LogView } from './log-view';

const DEFAULT_CONTROLLER = `def init(sim):
    sim.log("diff-drive controller ready")

def step(sim, dt):
    sim.set_joint_velocity("left_wheel_joint", 4.0)
    sim.set_joint_velocity("right_wheel_joint", 4.0)
`;

interface BodyVisual {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const viewport = document.querySelector('#viewport') as HTMLDivElement;
const statusEl = document.querySelector('#status') as HTMLDivElement;
const logEl = document.querySelector('#log') as HTMLDivElement;
const logMeasurerEl = document.querySelector('#log-measurer') as HTMLDivElement;
const logPageEl = document.querySelector('#log-page') as HTMLSpanElement;
const logPrevBtn = document.querySelector('#log-prev') as HTMLButtonElement;
const logNextBtn = document.querySelector('#log-next') as HTMLButtonElement;
const logFilterButtons = document.querySelectorAll<HTMLButtonElement>('.filter-chip');
const syncModeEl = document.querySelector('#sync-mode') as HTMLSelectElement;
const githubPanel = document.querySelector('#github-panel') as HTMLDivElement;
const githubRepoEl = document.querySelector('#github-repo') as HTMLInputElement;
const githubBranchEl = document.querySelector('#github-branch') as HTMLInputElement;
const githubTokenEl = document.querySelector('#github-token') as HTMLInputElement;
const projectRootEl = document.querySelector('#project-root') as HTMLInputElement;
const exampleSelectEl = document.querySelector('#example-select') as HTMLSelectElement;
const pickFolderBtn = document.querySelector('#pick-folder') as HTMLButtonElement;
const pauseBtn = document.querySelector('#pause-simulation') as HTMLButtonElement;
const reloadBtn = document.querySelector('#reload-controller') as HTMLButtonElement;
const softResetBtn = document.querySelector('#soft-reset') as HTMLButtonElement;
const controllerSourceEl = document.querySelector('#controller-source') as HTMLTextAreaElement;
const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab');
const tabPanels = document.querySelectorAll<HTMLElement>('[data-tab-panel]');

let config: SimConfig = DEFAULT_SIM_CONFIG;
let project: ProjectContext = DEFAULT_PROJECT_CONTEXT;
let urdfXml = DEFAULT_DIFF_DRIVE_URDF;
let envModel: WorldYamlConfig | undefined;
let robotMeta: RobotYamlConfig | undefined;
let worker: Worker | null = null;
let workerReady = false;
let pendingSyncBundle: SyncBundle | null = null;
let repoHandle: FileSystemDirectoryHandle | null = null;
let localSync: LocalFolderSync | null = null;
let githubSync: GitHubSync | null = null;
let robotVisualObjects = new Map<string, THREE.Object3D>();
let simulationPaused = false;

const bodyVisuals = new Map<string, BodyVisual>();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
applyEnvVisualSettings(scene);

const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
camera.position.set(3.5, 2.5, 4.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.3, 0);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(6, 10, 4);
sun.castShadow = true;
scene.add(sun);

const envGroup = new THREE.Group();
scene.add(envGroup);
let envVisuals: EnvVisualBuildResult = buildLegacyEnvVisuals();
envGroup.add(envVisuals.group);

const logView = new LogView({
  listEl: logEl,
  measurerEl: logMeasurerEl,
  pageLabelEl: logPageEl,
  prevBtn: logPrevBtn,
  nextBtn: logNextBtn,
  filterButtons: [...logFilterButtons],
});

function appendLog(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  logView.append(message, level);
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function selectTab(name: string): void {
  tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.tabPanel === name);
  });
  if (name === 'logs') {
    requestAnimationFrame(() => logView.relayout());
  }
}

function pyodideIndexUrl(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  // Copied assets for production; Vite serves the same path in dev via static-copy.
  return `${self.location.origin}${base}pyodide/`;
}

function applyPendingSyncIfReady(): void {
  if (!workerReady || !pendingSyncBundle) return;
  const bundle = pendingSyncBundle;
  pendingSyncBundle = null;
  applySyncBundle(bundle, false);
}

function flushWorldFromState(): void {
  loadWorld();
  reloadController(controllerSourceEl.value, false);
}

function currentProjectRoot(): string {
  return normalizeProjectRoot(projectRootEl.value);
}

function ensureBodyVisual(id: string, object: THREE.Object3D): BodyVisual {
  const existing = bodyVisuals.get(id);
  if (existing) return existing;

  object.castShadow = true;
  object.receiveShadow = true;
  scene.add(object);

  const visual: BodyVisual = {
    mesh: object,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  };
  bodyVisuals.set(id, visual);
  return visual;
}

function rebuildEnvVisuals(model?: WorldYamlConfig): void {
  envVisuals.dispose();
  envGroup.clear();

  envVisuals = model ? buildEnvVisuals(model) : buildLegacyEnvVisuals();
  envGroup.add(envVisuals.group);
  applyEnvVisualSettings(scene, model);
  appendLog(`Environment visuals rebuilt${model?.name ? `: ${model.name}` : ''}`);
}

function rebuildRobotVisuals(): void {
  for (const object of robotVisualObjects.values()) {
    scene.remove(object);
  }
  disposeRobotVisuals(robotVisualObjects);

  for (const id of [...bodyVisuals.keys()]) {
    if (id === 'ground') continue;
    const visual = bodyVisuals.get(id);
    if (visual) scene.remove(visual.mesh);
    bodyVisuals.delete(id);
  }

  try {
    const model = parseUrdf(urdfXml);
    const spawn = spawnToTransform(resolveSpawnConfig(config));
    robotVisualObjects = buildVisualsFromUrdf(model, spawn);

    for (const [id, mesh] of robotVisualObjects.entries()) {
      ensureBodyVisual(id, mesh);
    }
    appendLog(`Visuals rebuilt from URDF (${robotVisualObjects.size} links)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`URDF visuals failed: ${message}`, 'error');
  }
}

function applyTransforms(bodies: BodyTransform[]): void {
  let base: BodyTransform | undefined;

  for (const body of bodies) {
    const visual = bodyVisuals.get(body.id);
    if (!visual) continue;

    if (body.id === 'base_link') base = body;

    scratchPosition.set(body.x, body.y, body.z);
    scratchQuaternion.set(body.qx, body.qy, body.qz, body.qw);

    if (!visual.position.equals(scratchPosition)) {
      visual.position.copy(scratchPosition);
      visual.mesh.position.copy(scratchPosition);
    }

    if (!visual.quaternion.equals(scratchQuaternion)) {
      visual.quaternion.copy(scratchQuaternion);
      visual.mesh.quaternion.copy(scratchQuaternion);
    }
  }

  if (base) {
    controls.target.set(base.x, base.y + 0.25, base.z);
  }
}

function populateExampleSelect(examples: ExampleEntry[]): void {
  exampleSelectEl.innerHTML = '<option value="">— custom path above —</option>';
  for (const example of examples) {
    const option = document.createElement('option');
    option.value = example.path;
    option.textContent = example.label;
    exampleSelectEl.appendChild(option);
  }
}

async function loadExamplesManifest(): Promise<void> {
  if (repoHandle) {
    const manifest = await readExamplesManifestFromHandle(repoHandle);
    if (manifest) populateExampleSelect(manifest.examples);
    return;
  }

  const parsed = parseGitHubRepo(githubRepoEl.value);
  if (!parsed) return;

  const manifest = await fetchExamplesManifestFromGitHub(
    parsed.owner,
    parsed.repo,
    githubBranchEl.value.trim() || 'main',
    githubTokenEl.value.trim() || undefined,
  );
  if (manifest) populateExampleSelect(manifest.examples);
}

function robotModelFromUrdf(): ReturnType<typeof parseUrdf> {
  return parseUrdf(urdfXml);
}

function spawnWorker(): Worker {
  const simWorker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });

  simWorker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
    const message = event.data;
    switch (message.type) {
      case 'READY':
        workerReady = true;
        setStatus(
          `Worker ready\nRapier: ${message.rapierReady ? 'yes' : 'no'}\nPyodide: ${message.pyodideReady ? 'yes' : 'pending…'}\nProject: ${project.root || '(repo root)'}`,
        );
        if (message.pyodideReady) {
          appendLog('Pyodide ready');
          reloadController(controllerSourceEl.value, false);
          break;
        }
        appendLog('Simulation worker ready (physics)');
        if (pendingSyncBundle) {
          applyPendingSyncIfReady();
        } else {
          flushWorldFromState();
        }
        break;
      case 'WORLD_LOADED':
        appendLog(`Physics world: ${message.linkNames.join(', ')}`);
        break;
      case 'FRAME':
        applyTransforms(message.bodies);
        break;
      case 'LOG':
        appendLog(message.message, message.level);
        break;
      case 'CONTROLLER_VIOLATION':
        appendLog(
          `Controller slow: ${message.durationMs.toFixed(2)}ms (${message.violations}/${message.maxViolations})`,
          'warn',
        );
        break;
      case 'CONTROLLER_DISABLED':
        appendLog(`Controller disabled: ${message.reason}`, 'error');
        break;
      case 'ERROR':
        appendLog(message.message, 'error');
        break;
      case 'PAUSED':
        simulationPaused = message.paused;
        pauseBtn.textContent = message.paused ? 'Resume' : 'Pause';
        break;
      default:
        break;
    }
  };

  simWorker.onerror = (error) => {
    appendLog(error.message ?? 'Worker error', 'error');
  };

  simWorker.postMessage({
    type: 'INIT',
    pyodideIndexUrl: pyodideIndexUrl(),
    config,
    envModel,
    robotModel: robotModelFromUrdf(),
    robotMeta,
  });

  return simWorker;
}

function loadWorld(): void {
  if (!worker || !workerReady) return;
  rebuildEnvVisuals(envModel);
  rebuildRobotVisuals();
  worker.postMessage({
    type: 'LOAD_WORLD',
    config,
    envModel,
    robotModel: robotModelFromUrdf(),
    robotMeta,
  });
}

function reloadController(python: string, softReset = true): void {
  if (!worker || !workerReady) return;
  worker.postMessage({
    type: 'RELOAD_CONTROLLER',
    python,
    config,
    softReset: softReset && (config.reload?.policy ?? 'soft_reset') === 'soft_reset',
  });
}

function applySyncBundle(bundle: SyncBundle, queueIfBooting = true): void {
  project = bundle.project;
  config = bundle.config;
  urdfXml = bundle.urdfXml;
  envModel = bundle.envModel;
  robotMeta = bundle.robotMeta;
  projectRootEl.value = bundle.project.root;
  controllerSourceEl.value = bundle.controllerPython;

  if (bundle.resolvedPaths.environment) {
    appendLog(`Env: ${bundle.resolvedPaths.environment}`);
  }
  appendLog(`Bot: ${bundle.resolvedPaths.robotUrdf}`);
  appendLog(
    `Controller: ${bundle.controllerSource}${bundle.controllerSource !== 'none' ? ` (${bundle.resolvedPaths.controller})` : ''}`,
  );

  if (!workerReady && queueIfBooting) {
    pendingSyncBundle = bundle;
    appendLog(`Queued sync ${bundle.project.root || 'repo root'} (worker booting)`);
    return;
  }

  loadWorld();
  reloadController(bundle.controllerPython, true);
  appendLog(`Synced ${bundle.project.root || 'repo root'} @ ${bundle.revision.slice(0, 12)}…`);
}

async function loadBundledProject(root: string): Promise<void> {
  try {
    const bundle = await loadBundledSimulation(root);
    applySyncBundle(bundle);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`Bundled load failed: ${message}`, 'error');
  }
}

function stopSync(): void {
  localSync?.stopWatching();
  githubSync?.stopPolling();
  localSync = null;
  githubSync = null;
}

async function refreshLocalSync(): Promise<void> {
  if (!repoHandle) return;
  localSync?.stopWatching();
  localSync = new LocalFolderSync({
    repoHandle,
    projectRoot: currentProjectRoot(),
  });
  localSync.onLog((message, level) => appendLog(message, level));
  localSync.onBundle(applySyncBundle);
  localSync.startWatching(500);
  const bundle = await localSync.readOnce();
  applySyncBundle(bundle);
}

function startGitHubSync(): void {
  const parsed = parseGitHubRepo(githubRepoEl.value);
  if (!parsed) {
    appendLog('Enter a valid GitHub repo as owner/name', 'warn');
    return;
  }

  githubSync = new GitHubSync({
    owner: parsed.owner,
    repo: parsed.repo,
    branch: githubBranchEl.value.trim() || 'main',
    token: githubTokenEl.value.trim() || undefined,
    pollIntervalSec: config.sync?.poll_interval_sec ?? 15,
    projectRoot: currentProjectRoot(),
  });
  githubSync.onLog((message, level) => appendLog(message, level));
  githubSync.onBundle(applySyncBundle);
  githubSync.startPolling();
  void githubSync.readOnce().then((bundle) => applySyncBundle(bundle));
  appendLog(`GitHub polling ${parsed.owner}/${parsed.repo} (${currentProjectRoot() || 'root'})`);
}

function startSyncMode(mode: 'local' | 'github' | 'manual'): void {
  stopSync();
  githubPanel.hidden = mode !== 'github';
  pickFolderBtn.hidden = mode !== 'local';

  if (mode === 'github') {
    void loadExamplesManifest();
    startGitHubSync();
  }
}

function resize(): void {
  const { clientWidth, clientHeight } = viewport;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight, false);
}

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

controllerSourceEl.value = DEFAULT_CONTROLLER;
setStatus('Booting worker…');
worker = spawnWorker();

window.addEventListener('resize', resize);
resize();
animate();

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab) selectTab(btn.dataset.tab);
  });
});

reloadBtn.addEventListener('click', () => {
  reloadController(controllerSourceEl.value, true);
});

pauseBtn.addEventListener('click', () => {
  worker?.postMessage({ type: 'SET_PAUSED', paused: !simulationPaused });
});

softResetBtn.addEventListener('click', () => {
  worker?.postMessage({ type: 'SOFT_RESET' });
});

pickFolderBtn.addEventListener('click', () => {
  void (async () => {
    try {
      const handle = await pickProjectFolder();
      if (!handle) return;
      repoHandle = handle;
      await loadExamplesManifest();
      await refreshLocalSync();
      appendLog(`Watching repo: ${handle.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(message, 'error');
    }
  })();
});

projectRootEl.addEventListener('change', () => {
  project = { root: currentProjectRoot() };
  if (localSync && repoHandle) void refreshLocalSync();
  if (githubSync) {
    githubSync.setProjectRoot(currentProjectRoot());
    void githubSync.readOnce().then((bundle) => applySyncBundle(bundle));
    return;
  }
  if (syncModeEl.value === 'manual' && currentProjectRoot()) {
    void loadBundledProject(currentProjectRoot());
  }
});

exampleSelectEl.addEventListener('change', () => {
  if (!exampleSelectEl.value) return;
  projectRootEl.value = exampleSelectEl.value;
  project = { root: currentProjectRoot() };
  if (localSync && repoHandle) void refreshLocalSync();
  else if (githubSync) {
    githubSync.setProjectRoot(currentProjectRoot());
    void githubSync.readOnce().then((bundle) => applySyncBundle(bundle));
  } else {
    void loadBundledProject(currentProjectRoot());
  }
});

syncModeEl.addEventListener('change', () => {
  const mode = syncModeEl.value as 'local' | 'github' | 'manual';
  if (mode === 'manual') {
    stopSync();
    githubPanel.hidden = true;
    pickFolderBtn.hidden = true;
    return;
  }
  startSyncMode(mode);
});

const params = new URLSearchParams(window.location.search);
const repoParam = params.get('repo');
const rootParam = params.get('root');
if (rootParam) projectRootEl.value = rootParam;

if (repoParam) {
  syncModeEl.value = 'github';
  githubRepoEl.value = repoParam;
  githubBranchEl.value = params.get('branch') ?? 'main';
  void loadExamplesManifest().then(() => {
    if (rootParam) exampleSelectEl.value = rootParam;
    startSyncMode('github');
  });
} else {
  pickFolderBtn.hidden = syncModeEl.value !== 'local';
  githubPanel.hidden = syncModeEl.value !== 'github';
  void fetch(`${import.meta.env.BASE_URL}examples.yaml`)
    .then((response) => (response.ok ? response.text() : null))
    .then((raw) => {
      if (!raw) return;
      const examples = parseExamplesManifest(raw).examples;
      populateExampleSelect(examples);
      if (rootParam) {
        exampleSelectEl.value = rootParam;
        void loadBundledProject(rootParam);
      }
    })
    .catch(() => {
      /* optional bundled examples manifest */
    });
}
