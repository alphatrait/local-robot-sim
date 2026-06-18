import type { SimYamlConfig } from './types';
import { DEFAULT_SIM_CONFIG } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function asVec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const [x, y, z] = value;
  if ([x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return [x, y, z];
  }
  return fallback;
}

/**
 * Parses sim.yaml with unknown keys ignored for forward compatibility.
 */
export function parseSimYaml(raw: string): SimYamlConfig {
  let parsed: unknown;
  try {
    parsed = parseYamlSubset(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse sim.yaml: ${message}`);
  }

  const root = asRecord(parsed);
  if (!root) {
    throw new Error('sim.yaml root must be a mapping');
  }

  const robot = asRecord(root.robot) ?? {};
  const controller = asRecord(root.controller) ?? {};
  const simulation = asRecord(root.simulation) ?? {};
  const reload = asRecord(root.reload);

  const config: SimYamlConfig = {
    version: asNumber(root.version, DEFAULT_SIM_CONFIG.version),
    robot: {
      urdf: asString(robot.urdf, DEFAULT_SIM_CONFIG.robot.urdf),
      spawn: asVec3(robot.spawn, DEFAULT_SIM_CONFIG.robot.spawn ?? [0, 0.25, 0]),
    },
    controller: {
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
    },
    simulation: {
      gravity: asVec3(simulation.gravity, DEFAULT_SIM_CONFIG.simulation.gravity),
      physics_hz: asNumber(simulation.physics_hz, DEFAULT_SIM_CONFIG.simulation.physics_hz),
    },
  };

  if (reload) {
    const policy = reload.policy;
    if (policy === 'soft_reset' || policy === 'preserve_physics' || policy === 'pause_then_reset') {
      config.reload = { policy };
    }
  }

  return config;
}

/**
 * Minimal YAML parser for the flat sim.yaml schema (no external deps).
 */
function parseYamlSubset(raw: string): unknown {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [
    { indent: -1, obj: root },
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1].obj;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const valuePart = trimmed.slice(colonIndex + 1).trim();

    if (valuePart === '') {
      const child: Record<string, unknown> = {};
      current[key] = child;
      stack.push({ indent, obj: child });
      continue;
    }

    current[key] = parseScalar(valuePart);
  }

  return root;
}

function parseScalar(value: string): unknown {
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => parseScalar(part.trim()));
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  const num = Number(value);
  if (!Number.isNaN(num)) return num;

  return value;
}
