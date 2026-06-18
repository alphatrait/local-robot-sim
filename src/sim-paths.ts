import { joinProjectPath } from './project-path';
import { getControllerSettings, isModularConfig } from './sim-config';
import type { SimConfig } from './types';

export const SIM_PATH_DEFAULTS = {
  environment: 'env/world.yaml',
  robotUrdf: 'bot/robot.urdf',
  robotMeta: 'bot/robot.yaml',
  scenarioController: 'controllers/main.py',
  botController: 'bot/controllers/main.py',
} as const;

export interface ResolvedSimulationPaths {
  simYaml: string;
  environment: string;
  robotUrdf: string;
  robotMeta: string;
  scenarioController: string;
  botController: string;
}

function assertSafeRelativePath(relativePath: string, label: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.includes('..')) {
    throw new Error(`${label} path must stay inside the simulation folder: ${relativePath}`);
  }
  return normalized;
}

export function resolveSimulationPaths(
  projectRoot: string,
  config: SimConfig,
): ResolvedSimulationPaths {
  const simYaml = joinProjectPath(projectRoot, 'sim.yaml');

  if (isModularConfig(config)) {
    const environment = assertSafeRelativePath(
      config.environment ?? SIM_PATH_DEFAULTS.environment,
      'environment',
    );
    const robotUrdf = assertSafeRelativePath(config.robot ?? SIM_PATH_DEFAULTS.robotUrdf, 'robot');
    const robotMeta = robotUrdf.endsWith('.urdf')
      ? robotUrdf.replace(/\.urdf$/i, '.yaml')
      : SIM_PATH_DEFAULTS.robotMeta;

    const controllerSettings = getControllerSettings(config);
    const scenarioController = assertSafeRelativePath(
      controllerSettings.path,
      'controller',
    );

    return {
      simYaml,
      environment: joinProjectPath(projectRoot, environment),
      robotUrdf: joinProjectPath(projectRoot, robotUrdf),
      robotMeta: joinProjectPath(projectRoot, robotMeta),
      scenarioController: joinProjectPath(projectRoot, scenarioController),
      botController: joinProjectPath(projectRoot, SIM_PATH_DEFAULTS.botController),
    };
  }

  const controllerSettings = getControllerSettings(config);
  return {
    simYaml,
    environment: '',
    robotUrdf: joinProjectPath(projectRoot, config.robot.urdf),
    robotMeta: '',
    scenarioController: joinProjectPath(projectRoot, controllerSettings.path),
    botController: joinProjectPath(projectRoot, SIM_PATH_DEFAULTS.botController),
  };
}

export type ControllerSource = 'scenario' | 'bot' | 'none';

export interface ResolvedController {
  path: string;
  source: ControllerSource;
}
