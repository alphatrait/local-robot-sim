import { joinProjectPath } from './project-path';
import { defaultRobotMeta, parseRobotYaml } from './robot-yaml';
import { getControllerSettings, isModularConfig } from './sim-config';
import { resolveSimulationPaths, type ControllerSource } from './sim-paths';
import { parseSimYaml } from './sim-yaml';
import type { ProjectContext, SyncBundle } from './types';
import { parseWorldYaml } from './world-yaml';

export interface SimulationFileReader {
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

async function readOptionalText(
  reader: SimulationFileReader,
  path: string,
): Promise<string | undefined> {
  if (!path) return undefined;
  const exists = await reader.exists(path);
  if (!exists) return undefined;
  return reader.readText(path);
}

async function resolveController(
  reader: SimulationFileReader,
  paths: ReturnType<typeof resolveSimulationPaths>,
  config: ReturnType<typeof parseSimYaml>,
): Promise<{ python: string; source: ControllerSource; path: string }> {
  const controllerSettings = getControllerSettings(config);

  if (await reader.exists(paths.scenarioController)) {
    return {
      python: await reader.readText(paths.scenarioController),
      source: 'scenario',
      path: paths.scenarioController,
    };
  }

  if (isModularConfig(config) && (await reader.exists(paths.botController))) {
    return {
      python: await reader.readText(paths.botController),
      source: 'bot',
      path: paths.botController,
    };
  }

  if (!isModularConfig(config)) {
    throw new Error(`Controller not found: ${paths.scenarioController}`);
  }

  console.warn('[sim] No controller found — running physics only');
  return {
    python: '',
    source: 'none',
    path: controllerSettings.path,
  };
}

export async function loadSimulationBundle(
  project: ProjectContext,
  reader: SimulationFileReader,
): Promise<SyncBundle> {
  const simYamlPath = joinProjectPath(project.root, 'sim.yaml');
  const simYaml = await reader.readText(simYamlPath);
  const config = parseSimYaml(simYaml);
  const paths = resolveSimulationPaths(project.root, config);

  let envYaml: string | undefined;
  let envModel: SyncBundle['envModel'];
  if (isModularConfig(config)) {
    envYaml = await reader.readText(paths.environment);
    envModel = parseWorldYaml(envYaml);
  }

  const urdfXml = await reader.readText(paths.robotUrdf);

  let robotMetaYaml: string | undefined;
  let robotMeta = defaultRobotMeta();
  const robotMetaText = await readOptionalText(reader, paths.robotMeta);
  if (robotMetaText) {
    robotMetaYaml = robotMetaText;
    robotMeta = parseRobotYaml(robotMetaText);
  } else if (isModularConfig(config)) {
    console.warn('[sim] No bot/robot.yaml — using drive_model: auto');
  }

  const controller = await resolveController(reader, paths, config);

  const revision = await digestText(
    simYaml + (envYaml ?? '') + urdfXml + (robotMetaYaml ?? '') + controller.python,
  );

  return {
    project,
    config,
    envYaml,
    envModel,
    urdfXml,
    robotMeta,
    robotMetaYaml,
    controllerPython: controller.python,
    controllerSource: controller.source,
    resolvedPaths: {
      environment: paths.environment || undefined,
      robotUrdf: paths.robotUrdf,
      controller: controller.path,
    },
    revision,
  };
}

export async function digestText(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
