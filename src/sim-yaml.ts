import type { SimConfig, SimYamlConfigV1, SimYamlConfigV2, SpawnConfig, ReloadConfig, SyncConfig } from './types';
import { DEFAULT_SIM_CONFIG } from './types';
import {
  asNumber,
  asRecord,
  asString,
  asVec3,
  asVec4,
  parseYamlDocument,
} from './yaml-subset';

function parseControllerBlock(controller: Record<string, unknown>) {
  return {
    path: asString(controller.path, DEFAULT_SIM_CONFIG.controller.path),
    entrypoint: asString(controller.entrypoint, DEFAULT_SIM_CONFIG.controller.entrypoint),
    loop_hz: asNumber(controller.loop_hz, DEFAULT_SIM_CONFIG.controller.loop_hz),
    max_step_ms: asNumber(
      controller.max_step_ms,
      DEFAULT_SIM_CONFIG.controller.max_step_ms ?? 8,
    ),
    max_violations: asNumber(
      controller.max_violations,
      DEFAULT_SIM_CONFIG.controller.max_violations ?? 3,
    ),
  };
}

function parseReload(reload: Record<string, unknown> | null): ReloadConfig | undefined {
  if (!reload) return undefined;
  const policy = reload.policy;
  if (policy === 'soft_reset' || policy === 'preserve_physics' || policy === 'pause_then_reset') {
    return { policy };
  }
  return undefined;
}

function parseSync(sync: Record<string, unknown> | null): SyncConfig | undefined {
  if (!sync) return undefined;
  const mode = sync.mode;
  if (mode !== 'local' && mode !== 'github') return undefined;
  return {
    mode,
    poll_interval_sec:
      typeof sync.poll_interval_sec === 'number' ? sync.poll_interval_sec : undefined,
  };
}

function parseSpawnBlock(spawn: Record<string, unknown> | null): SpawnConfig {
  if (!spawn) {
    return { position: [0, 0.05, 0], rotation: [0, 0, 0, 1] };
  }

  const position = asVec3(spawn.position, [0, 0.05, 0]);
  const rotation = spawn.rotation ? asVec4(spawn.rotation, [0, 0, 0, 1]) : [0, 0, 0, 1] as [number, number, number, number];

  return { position, rotation };
}

function parseSimYamlV2(root: Record<string, unknown>): SimYamlConfigV2 {
  const controller = asRecord(root.controller);
  const simulation = asRecord(root.simulation) ?? {};
  const spawn = asRecord(root.spawn);

  if (simulation.gravity !== undefined) {
    console.warn('[sim.yaml] simulation.gravity is ignored in v2 — set gravity in env/world.yaml');
  }

  const config: SimYamlConfigV2 = {
    version: 2,
    environment: typeof root.environment === 'string' ? root.environment : undefined,
    robot: typeof root.robot === 'string' ? root.robot : undefined,
    spawn: parseSpawnBlock(spawn),
    simulation: {
      physics_hz: asNumber(simulation.physics_hz, DEFAULT_SIM_CONFIG.simulation.physics_hz),
    },
  };

  if (controller) {
    config.controller = parseControllerBlock(controller);
  }

  const reload = parseReload(asRecord(root.reload));
  if (reload) config.reload = reload;

  const sync = parseSync(asRecord(root.sync));
  if (sync) config.sync = sync;

  return config;
}

function parseSimYamlV1(root: Record<string, unknown>): SimYamlConfigV1 {
  const robot = asRecord(root.robot) ?? {};
  const controller = asRecord(root.controller) ?? {};
  const simulation = asRecord(root.simulation) ?? {};

  const config: SimYamlConfigV1 = {
    version: asNumber(root.version, DEFAULT_SIM_CONFIG.version),
    robot: {
      urdf: asString(robot.urdf, DEFAULT_SIM_CONFIG.robot.urdf),
      spawn: asVec3(robot.spawn, DEFAULT_SIM_CONFIG.robot.spawn ?? [0, 0.25, 0]),
    },
    controller: parseControllerBlock(controller),
    simulation: {
      gravity: asVec3(simulation.gravity, DEFAULT_SIM_CONFIG.simulation.gravity),
      physics_hz: asNumber(simulation.physics_hz, DEFAULT_SIM_CONFIG.simulation.physics_hz),
    },
  };

  const reload = parseReload(asRecord(root.reload));
  if (reload) config.reload = reload;

  const sync = parseSync(asRecord(root.sync));
  if (sync) config.sync = sync;

  return config;
}

/**
 * Parses sim.yaml with unknown keys ignored for forward compatibility.
 */
export function parseSimYaml(raw: string): SimConfig {
  const root = parseYamlDocument(raw, 'sim.yaml');
  const version = asNumber(root.version, DEFAULT_SIM_CONFIG.version);

  if (version >= 2 || typeof root.environment === 'string') {
    return parseSimYamlV2(root);
  }

  return parseSimYamlV1(root);
}
