/// <reference lib="webworker" />

import RAPIER from '@dimforge/rapier3d-compat';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import type {
  BodyTransform,
  MainToWorkerMessage,
  SimYamlConfig,
  WorkerToMainMessage,
} from './types';
import { DEFAULT_SIM_CONFIG } from './types';
import type { UrdfModel } from './urdf-parser';
import {
  buildGround,
  buildRobotFromUrdf,
  type PrismaticMotor,
  type RapierTrackedBody,
  type RevoluteMotor,
} from './urdf-rapier';
import type { Transform3D } from './urdf-math';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let rapierReady = false;
let pyodideReady = false;
let pyodide: PyodideInterface | null = null;

let world: RAPIER.World | null = null;
let integrationParameters: RAPIER.IntegrationParameters | null = null;
let trackedBodies: RapierTrackedBody[] = [];
let revoluteMotors: Map<string, RevoluteMotor> = new Map();
let prismaticMotors: Map<string, PrismaticMotor> = new Map();
let robotLinkNames = new Set<string>();

let config: SimYamlConfig = DEFAULT_SIM_CONFIG;
let robotModel: UrdfModel | null = null;
let simTime = 0;
let loopHandle: ReturnType<typeof setInterval> | null = null;

let controllerEnabled = true;
let controllerViolations = 0;
let controllerLoaded = false;
let pendingPython: string | null = null;

const scratchTransforms: BodyTransform[] = [];

function post(message: WorkerToMainMessage): void {
  ctx.postMessage(message);
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  post({ type: 'LOG', level, message });
}

function spawnTransform(): Transform3D {
  const spawn = config.robot.spawn ?? [0, 0.25, 0];
  return { xyz: spawn, quat: [0, 0, 0, 1] };
}

async function bootRapier(): Promise<void> {
  try {
    await RAPIER.init();
    rapierReady = true;
    log('info', 'Rapier Wasm ready');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: 'ERROR', message: `Rapier init failed: ${message}` });
    throw error;
  }
}

async function bootPyodide(indexUrl: string): Promise<void> {
  try {
    pyodide = await loadPyodide({ indexURL: indexUrl });
    pyodideReady = true;
    log('info', 'Pyodide ready');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: 'ERROR', message: `Pyodide init failed: ${message}` });
    throw error;
  }
}

function clearWorld(): void {
  if (loopHandle !== null) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
  revoluteMotors.clear();
  prismaticMotors.clear();
  robotLinkNames.clear();
  trackedBodies = [];
  world?.free();
  world = null;
  integrationParameters = null;
  simTime = 0;
}

function buildSceneFromUrdf(): void {
  if (!rapierReady || !robotModel) return;

  clearWorld();

  const [gx, gy, gz] = config.simulation.gravity;
  world = new RAPIER.World({ x: gx, y: gy, z: gz });
  integrationParameters = world.integrationParameters;
  integrationParameters.dt = 1 / config.simulation.physics_hz;

  const ground = buildGround(RAPIER, world);
  trackedBodies.push(ground);

  try {
    const robot = buildRobotFromUrdf(RAPIER, world, robotModel, spawnTransform());
    trackedBodies.push(...robot.trackedBodies);
    robotLinkNames = robot.robotLinkNames;
    revoluteMotors = robot.revoluteMotors;
    prismaticMotors = robot.prismaticMotors;
    log('info', `URDF loaded: ${robotModel.name} (${robotModel.links.length} links)`);
    post({ type: 'WORLD_LOADED', linkNames: [...robotLinkNames] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: 'ERROR', message: `URDF build failed: ${message}` });
    throw error;
  }

  startSimulationLoop();
}

function applyJointMotors(): void {
  for (const motor of revoluteMotors.values()) {
    motor.joint?.configureMotorVelocity(motor.targetVelocity, 40.0);
  }
  for (const motor of prismaticMotors.values()) {
    motor.joint.configureMotorVelocity(motor.targetVelocity, 40.0);
  }
}

/** Diff-drive kinematics for fixed-wheel assemblies (v1 demo). */
function applyDiffDriveKinematics(): void {
  const left = revoluteMotors.get('left_wheel_joint')?.targetVelocity;
  const right = revoluteMotors.get('right_wheel_joint')?.targetVelocity;
  if (left === undefined || right === undefined) return;

  const base = trackedBodies.find((b) => b.id === 'base_link');
  if (!base) return;

  const wheelRadius = 0.08;
  const trackWidth = 0.56;
  const linear = ((left + right) * 0.5) * wheelRadius;
  const yawRate = ((right - left) / trackWidth) * wheelRadius;

  const lv = base.body.linvel();
  base.body.setLinvel({ x: lv.x, y: lv.y, z: linear }, true);
  base.body.setAngvel({ x: 0, y: yawRate, z: 0 }, true);
}

function collectTransforms(): BodyTransform[] {
  scratchTransforms.length = 0;
  for (const tracked of trackedBodies) {
    const t = tracked.body.translation();
    const r = tracked.body.rotation();
    scratchTransforms.push({
      id: tracked.id,
      x: t.x,
      y: t.y,
      z: t.z,
      qx: r.x,
      qy: r.y,
      qz: r.z,
      qw: r.w,
    });
  }
  return scratchTransforms;
}

function runControllerStep(dt: number): void {
  if (!controllerEnabled || !controllerLoaded || !pyodide) return;

  const t0 = performance.now();
  try {
    const sim = pyodide.globals.get('sim');
    const stepFn = pyodide.globals.get('step');
    if (stepFn && typeof stepFn === 'function') {
      stepFn(sim, dt);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Controller step error: ${message}`);
    controllerEnabled = false;
    post({ type: 'CONTROLLER_DISABLED', reason: message });
    return;
  } finally {
    const durationMs = performance.now() - t0;
    const maxStepMs = config.controller.max_step_ms ?? 8;
    if (durationMs > maxStepMs) {
      controllerViolations += 1;
      post({
        type: 'CONTROLLER_VIOLATION',
        durationMs,
        violations: controllerViolations,
        maxViolations: config.controller.max_violations ?? 3,
      });
      if (controllerViolations >= (config.controller.max_violations ?? 3)) {
        controllerEnabled = false;
        post({
          type: 'CONTROLLER_DISABLED',
          reason: `Exceeded ${maxStepMs}ms budget ${controllerViolations} times`,
        });
      }
    }
  }
}

function simulationTick(): void {
  if (!world || !integrationParameters) return;

  const dt = integrationParameters.dt;
  runControllerStep(dt);
  applyDiffDriveKinematics();
  applyJointMotors();
  world.step();
  simTime += dt;

  post({
    type: 'FRAME',
    bodies: collectTransforms(),
    simTime,
  });
}

function startSimulationLoop(): void {
  if (loopHandle !== null) clearInterval(loopHandle);
  const hz = config.simulation.physics_hz;
  loopHandle = setInterval(simulationTick, 1000 / hz);
}

function softResetRobot(): void {
  for (const tracked of trackedBodies) {
    if (!robotLinkNames.has(tracked.id)) continue;

    tracked.body.setTranslation(tracked.initialTranslation, true);
    tracked.body.setRotation(tracked.initialRotation, true);
    tracked.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    tracked.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  for (const motor of revoluteMotors.values()) motor.targetVelocity = 0;
  for (const motor of prismaticMotors.values()) motor.targetVelocity = 0;
}

function buildSimBridge(): string {
  return `
class SimBridge:
    def log(self, message):
        post_log(str(message))

    def time(self):
        return float(sim_time)

    def get_body_pose(self, body_id):
        return get_body_pose(str(body_id))

    def get_joint_states(self):
        return get_joint_states()

    def set_joint_velocity(self, joint_name, velocity):
        set_joint_velocity(str(joint_name), float(velocity))

sim = SimBridge()
`;
}

async function mountControllerBridge(): Promise<void> {
  const py = pyodide;
  if (!py) return;

  await py.runPythonAsync(buildSimBridge());

  py.globals.set('post_log', (message: string) => {
    log('info', `[py] ${message}`);
  });
  py.globals.set('sim_time', 0);

  py.globals.set('get_body_pose', (bodyId: string) => {
    const tracked = trackedBodies.find((b) => b.id === bodyId);
    if (!tracked) {
      return py.toPy({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
    }
    const t = tracked.body.translation();
    const r = tracked.body.rotation();
    return py.toPy({ x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w });
  });

  py.globals.set('get_joint_states', () => {
    const out: Record<string, number> = {};
    for (const [name, motor] of revoluteMotors.entries()) out[name] = motor.targetVelocity;
    for (const [name, motor] of prismaticMotors.entries()) out[name] = motor.targetVelocity;
    return py.toPy(out);
  });

  py.globals.set('set_joint_velocity', (jointName: string, velocity: number) => {
    const revolute = revoluteMotors.get(jointName);
    if (revolute) {
      revolute.targetVelocity = velocity;
      return;
    }
    const prismatic = prismaticMotors.get(jointName);
    if (prismatic) prismatic.targetVelocity = velocity;
  });
}

async function loadController(python: string, softReset: boolean): Promise<void> {
  if (!pyodideReady || !pyodide) {
    pendingPython = python;
    return;
  }

  if (softReset) softResetRobot();

  controllerEnabled = true;
  controllerViolations = 0;
  controllerLoaded = false;

  try {
    await mountControllerBridge();
    await pyodide.runPythonAsync(python);

    const sim = pyodide.globals.get('sim');
    const initFn = pyodide.globals.get('init');
    if (initFn && typeof initFn === 'function') {
      initFn(sim);
    }

    controllerLoaded = true;
    log('info', 'Controller loaded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Controller load failed: ${message}`);
    controllerLoaded = false;
    post({ type: 'CONTROLLER_DISABLED', reason: message });
  }
}

async function handleInit(message: Extract<MainToWorkerMessage, { type: 'INIT' }>): Promise<void> {
  config = message.config;
  robotModel = message.robotModel;
  log('info', 'Worker INIT received');

  await bootRapier();
  log('info', 'Rapier boot complete');

  try {
    buildSceneFromUrdf();
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    post({ type: 'ERROR', message: `Scene build failed: ${errMessage}` });
    throw error;
  }

  post({ type: 'READY', rapierReady, pyodideReady: false });

  void bootPyodide(message.pyodideIndexUrl)
    .then(async () => {
      post({ type: 'READY', rapierReady, pyodideReady: true });
      log('info', 'Pyodide boot complete');
      if (pendingPython) {
        const source = pendingPython;
        pendingPython = null;
        await loadController(source, true);
      }
    })
    .catch((error) => {
      const errMessage = error instanceof Error ? error.message : String(error);
      post({ type: 'ERROR', message: `Pyodide boot failed: ${errMessage}` });
    });
}

async function handleLoadWorld(
  message: Extract<MainToWorkerMessage, { type: 'LOAD_WORLD' }>,
): Promise<void> {
  config = message.config;
  robotModel = message.robotModel;
  buildSceneFromUrdf();
}

ctx.addEventListener('message', (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data;
  void (async () => {
    try {
      switch (message.type) {
        case 'INIT':
          await handleInit(message);
          break;
        case 'LOAD_WORLD':
          await handleLoadWorld(message);
          break;
        case 'RELOAD_CONTROLLER':
          config = message.config;
          await loadController(message.python, message.softReset);
          break;
        case 'SOFT_RESET':
          softResetRobot();
          log('info', 'Soft reset applied');
          break;
        default:
          break;
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      post({ type: 'ERROR', message: errMessage });
    }
  })();
});

setInterval(() => {
  if (pyodide) pyodide.globals.set('sim_time', simTime);
}, 16);
