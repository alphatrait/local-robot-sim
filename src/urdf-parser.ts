/**
 * URDF XML parser and Rapier spec conversion helpers.
 */

export type JointType = 'fixed' | 'revolute' | 'prismatic' | 'continuous';

export interface UrdfMaterial {
  name: string;
  color?: [number, number, number, number];
}

export interface UrdfGeometry {
  kind: 'box' | 'cylinder' | 'sphere' | 'mesh';
  size?: [number, number, number];
  radius?: number;
  length?: number;
  filename?: string;
}

export interface UrdfLink {
  name: string;
  visual?: {
    origin: { xyz: [number, number, number]; rpy: [number, number, number] };
    geometry: UrdfGeometry;
    material?: string;
  };
  collision?: {
    origin: { xyz: [number, number, number]; rpy: [number, number, number] };
    geometry: UrdfGeometry;
  };
}

export interface UrdfJoint {
  name: string;
  type: JointType;
  parent: string;
  child: string;
  origin: { xyz: [number, number, number]; rpy: [number, number, number] };
  axis?: [number, number, number];
  limit?: { lower: number; upper: number; effort: number; velocity: number };
}

export interface UrdfModel {
  name: string;
  links: UrdfLink[];
  joints: UrdfJoint[];
  materials: UrdfMaterial[];
}

export interface RapierBodySpec {
  linkName: string;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  collider: UrdfGeometry;
  mass: number;
  isFixed: boolean;
}

export interface RapierJointSpec {
  name: string;
  type: JointType;
  parentLink: string;
  childLink: string;
  axis: [number, number, number];
  limits?: { lower: number; upper: number };
}

export interface RapierRobotSpec {
  bodies: RapierBodySpec[];
  joints: RapierJointSpec[];
}

const DEFAULT_XYZ: [number, number, number] = [0, 0, 0];
const DEFAULT_RPY: [number, number, number] = [0, 0, 0];
const DEFAULT_AXIS: [number, number, number] = [0, 0, 1];

function parseFloats(text: string | null, count: number, fallback: number[]): number[] {
  if (!text) return fallback.slice(0, count);
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length !== count || parts.some((n) => Number.isNaN(n))) {
    return fallback.slice(0, count);
  }
  return parts;
}

function readOrigin(element: Element | null): {
  xyz: [number, number, number];
  rpy: [number, number, number];
} {
  if (!element) {
    return { xyz: DEFAULT_XYZ, rpy: DEFAULT_RPY };
  }
  const xyz = parseFloats(element.getAttribute('xyz'), 3, DEFAULT_XYZ) as [number, number, number];
  const rpy = parseFloats(element.getAttribute('rpy'), 3, DEFAULT_RPY) as [number, number, number];
  return { xyz, rpy };
}

function readGeometry(geometryEl: Element | null): UrdfGeometry | undefined {
  if (!geometryEl) return undefined;

  const box = geometryEl.querySelector('box');
  if (box) {
    const size = parseFloats(box.getAttribute('size'), 3, [1, 1, 1]) as [number, number, number];
    return { kind: 'box', size };
  }

  const cylinder = geometryEl.querySelector('cylinder');
  if (cylinder) {
    return {
      kind: 'cylinder',
      radius: parseFloats(cylinder.getAttribute('radius'), 1, [0.1])[0],
      length: parseFloats(cylinder.getAttribute('length'), 1, [0.1])[0],
    };
  }

  const sphere = geometryEl.querySelector('sphere');
  if (sphere) {
    return {
      kind: 'sphere',
      radius: parseFloats(sphere.getAttribute('radius'), 1, [0.1])[0],
    };
  }

  const mesh = geometryEl.querySelector('mesh');
  if (mesh) {
    return {
      kind: 'mesh',
      filename: mesh.getAttribute('filename') ?? undefined,
    };
  }

  return undefined;
}

/**
 * Parses URDF XML into a typed model. Uses DOMParser (browser-safe).
 */
export function parseUrdf(xml: string): UrdfModel {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`URDF XML parse error: ${parserError.textContent ?? 'unknown'}`);
  }

  const robotEl = doc.querySelector('robot');
  if (!robotEl) {
    throw new Error('URDF must contain a <robot> root element');
  }

  const materials: UrdfMaterial[] = [...robotEl.querySelectorAll(':scope > material')].map(
    (materialEl) => {
      const colorEl = materialEl.querySelector('color');
      const rgba = colorEl
        ? (parseFloats(colorEl.getAttribute('rgba'), 4, [0.8, 0.8, 0.8, 1]) as [
            number,
            number,
            number,
            number,
          ])
        : undefined;
      return {
        name: materialEl.getAttribute('name') ?? 'default',
        color: rgba,
      };
    },
  );

  const links: UrdfLink[] = [...robotEl.querySelectorAll(':scope > link')].map((linkEl) => {
    const visualEl = linkEl.querySelector('visual');
    const collisionEl = linkEl.querySelector('collision');

    const visual = visualEl
      ? {
          origin: readOrigin(visualEl.querySelector('origin')),
          geometry: readGeometry(visualEl.querySelector('geometry')) ?? {
            kind: 'box' as const,
            size: [0.1, 0.1, 0.1],
          },
          material: visualEl.querySelector('material')?.getAttribute('name') ?? undefined,
        }
      : undefined;

    const collision = collisionEl
      ? {
          origin: readOrigin(collisionEl.querySelector('origin')),
          geometry: readGeometry(collisionEl.querySelector('geometry')) ?? {
            kind: 'box' as const,
            size: [0.1, 0.1, 0.1],
          },
        }
      : undefined;

    return {
      name: linkEl.getAttribute('name') ?? 'unnamed_link',
      visual,
      collision,
    };
  });

  const joints: UrdfJoint[] = [...robotEl.querySelectorAll(':scope > joint')].map((jointEl) => {
    const typeAttr = jointEl.getAttribute('type') ?? 'fixed';
    const type = (
      ['fixed', 'revolute', 'prismatic', 'continuous'].includes(typeAttr)
        ? typeAttr
        : 'fixed'
    ) as JointType;

    const limitEl = jointEl.querySelector('limit');
    const axisEl = jointEl.querySelector('axis');

    return {
      name: jointEl.getAttribute('name') ?? 'unnamed_joint',
      type,
      parent: jointEl.querySelector('parent')?.getAttribute('link') ?? '',
      child: jointEl.querySelector('child')?.getAttribute('link') ?? '',
      origin: readOrigin(jointEl.querySelector('origin')),
      axis: axisEl
        ? (parseFloats(axisEl.getAttribute('xyz'), 3, DEFAULT_AXIS) as [number, number, number])
        : DEFAULT_AXIS,
      limit: limitEl
        ? {
            lower: parseFloats(limitEl.getAttribute('lower'), 1, [0])[0],
            upper: parseFloats(limitEl.getAttribute('upper'), 1, [0])[0],
            effort: parseFloats(limitEl.getAttribute('effort'), 1, [0])[0],
            velocity: parseFloats(limitEl.getAttribute('velocity'), 1, [0])[0],
          }
        : undefined,
    };
  });

  return {
    name: robotEl.getAttribute('name') ?? 'robot',
    links,
    joints,
    materials,
  };
}

/**
 * Converts URDF links/joints into Rapier body + joint specs.
 * Mesh collisions are downgraded to primitive boxes in v1.
 */
export function urdfToRapierSpec(model: UrdfModel): RapierRobotSpec {
  const childLinks = new Set(model.joints.map((joint) => joint.child));

  const bodies: RapierBodySpec[] = model.links.map((link) => {
    const collision = link.collision ?? link.visual;
    const geometry = collision?.geometry ?? { kind: 'box' as const, size: [0.1, 0.1, 0.1] };
    const primitiveGeometry =
      geometry.kind === 'mesh'
        ? ({ kind: 'box' as const, size: [0.2, 0.2, 0.2] } satisfies UrdfGeometry)
        : geometry;

    const origin = collision?.origin ?? { xyz: DEFAULT_XYZ, rpy: DEFAULT_RPY };

    return {
      linkName: link.name,
      translation: origin.xyz,
      rotation: [0, 0, 0, 1],
      collider: primitiveGeometry,
      mass: childLinks.has(link.name) ? 1 : link.name === 'base_link' ? 5 : 1,
      isFixed: false,
    };
  });

  const joints: RapierJointSpec[] = model.joints
    .filter((joint) => joint.type === 'revolute' || joint.type === 'prismatic')
    .map((joint) => ({
      name: joint.name,
      type: joint.type,
      parentLink: joint.parent,
      childLink: joint.child,
      axis: joint.axis ?? DEFAULT_AXIS,
      limits: joint.limit ? { lower: joint.limit.lower, upper: joint.limit.upper } : undefined,
    }));

  return { bodies, joints };
}
