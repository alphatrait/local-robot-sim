import type { WorldYamlConfig, StaticBodyConfig } from './types';
import {
  asNumber,
  asRecord,
  asString,
  asVec3,
  parseYamlDocument,
} from './yaml-subset';

const DEFAULT_WORLD: WorldYamlConfig = {
  version: 1,
  physics: {
    gravity: [0, -9.81, 0],
    friction: 0.8,
  },
  ground: {
    size: [20, 20],
    thickness: 0.1,
  },
};

function parseStaticBodies(root: Record<string, unknown>): StaticBodyConfig[] {
  const staticBodies = asRecord(root.static_bodies);
  if (!staticBodies) return [];

  const bodies: StaticBodyConfig[] = [];
  for (const [id, rawBody] of Object.entries(staticBodies)) {
    const body = asRecord(rawBody);
    if (!body) continue;

    const shape = asString(body.shape, 'box');
    if (shape !== 'box') continue;

    bodies.push({
      id,
      shape: 'box',
      size: asVec3(body.size, [1, 1, 1]),
      position: asVec3(body.position, [0, 0, 0]),
    });
  }

  return bodies;
}

function parseVisuals(root: Record<string, unknown>): WorldYamlConfig['visuals'] {
  const visuals = asRecord(root.visuals);
  if (!visuals) return undefined;

  const fogColor = visuals.fog_color;
  const groundColor = visuals.ground_color;

  return {
    grid_size: asNumber(visuals.grid_size, 40),
    fog_color: typeof fogColor === 'number' ? fogColor : undefined,
    ground_color: typeof groundColor === 'number' ? groundColor : undefined,
  };
}

export function parseWorldYaml(raw: string): WorldYamlConfig {
  const root = parseYamlDocument(raw, 'world.yaml');
  const physics = asRecord(root.physics) ?? {};
  const ground = asRecord(root.ground) ?? {};

  let size2d: [number, number] = DEFAULT_WORLD.ground.size;
  if (Array.isArray(ground.size) && ground.size.length >= 2) {
    const [x, z] = ground.size;
    if (typeof x === 'number' && typeof z === 'number') {
      size2d = [x, z];
    }
  }

  return {
    version: asNumber(root.version, DEFAULT_WORLD.version),
    name: typeof root.name === 'string' ? root.name : undefined,
    physics: {
      gravity: asVec3(physics.gravity, DEFAULT_WORLD.physics.gravity),
      friction: asNumber(physics.friction, DEFAULT_WORLD.physics.friction ?? 0.8),
    },
    ground: {
      size: size2d,
      thickness: asNumber(ground.thickness, DEFAULT_WORLD.ground.thickness ?? 0.1),
    },
    static_bodies: parseStaticBodies(root),
    visuals: parseVisuals(root),
  };
}
