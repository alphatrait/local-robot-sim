import type {
  ControllerConfig,
  DriveModel,
  SimConfig,
  SimYamlConfigV2,
  SpawnConfig,
} from './types';
import type { Transform3D } from './urdf-math';

export function isModularConfig(config: SimConfig): config is SimYamlConfigV2 {
  return config.version >= 2;
}

export function getControllerSettings(config: SimConfig): ControllerConfig {
  if (isModularConfig(config)) {
    const controller = config.controller ?? {};
    return {
      path: controller.path ?? 'controllers/main.py',
      entrypoint: controller.entrypoint ?? 'main',
      loop_hz: controller.loop_hz ?? 60,
      max_step_ms: controller.max_step_ms ?? 8,
      max_violations: controller.max_violations ?? 3,
    };
  }
  return config.controller;
}

export function getPhysicsHz(config: SimConfig): number {
  return config.simulation.physics_hz;
}

export function getLegacyGravity(config: SimConfig): [number, number, number] {
  if (isModularConfig(config)) {
    return [0, -9.81, 0];
  }
  return config.simulation.gravity;
}

export function resolveSpawnConfig(config: SimConfig): SpawnConfig {
  if (isModularConfig(config)) {
    return config.spawn;
  }
  return {
    position: config.robot.spawn ?? [0, 0.25, 0],
    rotation: [0, 0, 0, 1],
  };
}

export function spawnToTransform(spawn: SpawnConfig): Transform3D {
  const rotation = spawn.rotation ?? [0, 0, 0, 1];
  const len = Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]);
  const quat: [number, number, number, number] =
    len > 0
      ? [rotation[0] / len, rotation[1] / len, rotation[2] / len, rotation[3] / len]
      : [0, 0, 0, 1];

  return {
    xyz: spawn.position,
    quat,
  };
}

export function parseDriveModel(value: unknown): DriveModel {
  if (value === 'diff_drive' || value === 'articulated' || value === 'auto') {
    return value;
  }
  return 'auto';
}
