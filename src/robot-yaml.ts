import type { RobotYamlConfig } from './types';
import { parseDriveModel } from './sim-config';
import { asNumber, parseYamlDocument } from './yaml-subset';

const DEFAULT_ROBOT_META: RobotYamlConfig = {
  version: 1,
  drive_model: 'auto',
};

export function parseRobotYaml(raw: string): RobotYamlConfig {
  const root = parseYamlDocument(raw, 'robot.yaml');

  return {
    version: asNumber(root.version, DEFAULT_ROBOT_META.version),
    name: typeof root.name === 'string' ? root.name : undefined,
    drive_model: parseDriveModel(root.drive_model ?? DEFAULT_ROBOT_META.drive_model),
  };
}

export function defaultRobotMeta(): RobotYamlConfig {
  return { ...DEFAULT_ROBOT_META };
}
