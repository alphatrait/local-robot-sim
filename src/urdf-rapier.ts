import type RAPIER from '@dimforge/rapier3d-compat';
import type { UrdfGeometry, UrdfJoint, UrdfModel } from './urdf-parser';
import {
  composeTransforms,
  rapierRotation,
  rotateVectorByQuat,
  rpyToQuaternion,
  type Transform3D,
} from './urdf-math';

export interface RapierTrackedBody {
  id: string;
  body: RAPIER.RigidBody;
  initialTranslation: RAPIER.Vector;
  initialRotation: RAPIER.Rotation;
}

export interface RevoluteMotor {
  joint?: RAPIER.RevoluteImpulseJoint;
  targetVelocity: number;
}

export interface PrismaticMotor {
  joint: RAPIER.PrismaticImpulseJoint;
  targetVelocity: number;
}

export interface WheelVisualOffset {
  linkId: string;
  localXyz: [number, number, number];
  localRpy: [number, number, number];
}

export interface UrdfRobotBuildResult {
  trackedBodies: RapierTrackedBody[];
  revoluteMotors: Map<string, RevoluteMotor>;
  prismaticMotors: Map<string, PrismaticMotor>;
  robotLinkNames: Set<string>;
  wheelVisualOffsets?: WheelVisualOffset[];
  kinematicDrive?: boolean;
}

const IDENTITY: Transform3D = {
  xyz: [0, 0, 0],
  quat: [0, 0, 0, 1],
};

const DEFAULT_SPAWN: Transform3D = {
  xyz: [0, 0.25, 0],
  quat: [0, 0, 0, 1],
};

function findRootLink(model: UrdfModel): string {
  const childLinks = new Set(model.joints.map((joint) => joint.child));
  const roots = model.links.filter((link) => !childLinks.has(link.name));
  const base = roots.find((link) => link.name === 'base_link');
  return base?.name ?? roots[0]?.name ?? model.links[0]?.name ?? 'base_link';
}

function buildLinkTransforms(model: UrdfModel, spawn: Transform3D): Map<string, Transform3D> {
  const root = findRootLink(model);
  const jointsByParent = new Map<string, UrdfJoint[]>();
  for (const joint of model.joints) {
    const list = jointsByParent.get(joint.parent) ?? [];
    list.push(joint);
    jointsByParent.set(joint.parent, list);
  }

  const transforms = new Map<string, Transform3D>();
  const queue: string[] = [root];
  transforms.set(root, spawn);

  while (queue.length > 0) {
    const parentName = queue.shift()!;
    const parentTransform = transforms.get(parentName)!;
    const joints = jointsByParent.get(parentName) ?? [];

    for (const joint of joints) {
      const childTransform = composeTransforms(parentTransform, joint.origin);
      if (!transforms.has(joint.child)) {
        transforms.set(joint.child, childTransform);
        queue.push(joint.child);
      }
    }
  }

  for (const link of model.links) {
    if (!transforms.has(link.name)) {
      transforms.set(link.name, spawn);
    }
  }

  return transforms;
}

function colliderFromGeometry(
  R: typeof RAPIER,
  geometry: UrdfGeometry,
  localOrigin: { xyz: [number, number, number]; rpy: [number, number, number] },
): RAPIER.ColliderDesc {
  let desc: RAPIER.ColliderDesc;

  switch (geometry.kind) {
    case 'box': {
      const [sx, sy, sz] = geometry.size ?? [0.1, 0.1, 0.1];
      desc = R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
      break;
    }
    case 'cylinder': {
      const radius = geometry.radius ?? 0.1;
      const length = geometry.length ?? 0.1;
      desc = R.ColliderDesc.cylinder(length / 2, radius);
      // URDF cylinders are Z-aligned; Rapier uses Y. Roll axis is X (wheel axle).
      const alignX = rpyToQuaternion([0, 0, Math.PI / 2]);
      desc.setRotation(rapierRotation(alignX));
      break;
    }
    case 'sphere': {
      desc = R.ColliderDesc.ball(geometry.radius ?? 0.1);
      break;
    }
    case 'mesh':
    default: {
      desc = R.ColliderDesc.cuboid(0.1, 0.1, 0.1);
      break;
    }
  }

  desc.setTranslation(localOrigin.xyz[0], localOrigin.xyz[1], localOrigin.xyz[2]);
  desc.setFriction(1.2);
  desc.setRestitution(0.0);
  if (localOrigin.rpy.some((v) => v !== 0)) {
    const rot = rapierRotation(rpyToQuaternion(localOrigin.rpy));
    desc.setRotation(rot);
  }

  return desc;
}

function axisInParentFrame(
  axis: [number, number, number],
  parentQuat: [number, number, number, number],
): { x: number; y: number; z: number } {
  const rotated = rotateVectorByQuat(axis, parentQuat);
  const len = Math.hypot(rotated[0], rotated[1], rotated[2]) || 1;
  return { x: rotated[0] / len, y: rotated[1] / len, z: rotated[2] / len };
}

function isDiffDriveModel(model: UrdfModel): boolean {
  const jointNames = new Set(model.joints.map((joint) => joint.name));
  return jointNames.has('left_wheel_joint') && jointNames.has('right_wheel_joint');
}

function buildDiffDriveKinematic(
  R: typeof RAPIER,
  world: RAPIER.World,
  model: UrdfModel,
  spawn: Transform3D,
): UrdfRobotBuildResult {
  const linkTransforms = buildLinkTransforms(model, spawn);
  const baseFrame = linkTransforms.get('base_link') ?? spawn;
  const revoluteMotors = new Map<string, RevoluteMotor>();
  const wheelVisualOffsets: WheelVisualOffset[] = [];

  const bodyDesc = R.RigidBodyDesc.kinematicVelocityBased()
    .setTranslation(baseFrame.xyz[0], baseFrame.xyz[1], baseFrame.xyz[2])
    .setRotation(rapierRotation(baseFrame.quat));

  const body = world.createRigidBody(bodyDesc);

  // Chassis collider: bottom face sits on ground top (y = 0.05).
  const chassis = R.ColliderDesc.cuboid(0.35, 0.08, 0.25);
  chassis.setTranslation(0, 0.08, 0);
  chassis.setFriction(1.2);
  chassis.setRestitution(0.0);
  world.createCollider(chassis, body);

  for (const joint of model.joints) {
    if (!joint.name.includes('wheel')) continue;
    revoluteMotors.set(joint.name, { targetVelocity: 0 });
    wheelVisualOffsets.push({
      linkId: joint.child,
      localXyz: joint.origin.xyz,
      localRpy: joint.origin.rpy,
    });
  }

  const trackedBodies: RapierTrackedBody[] = [
    {
      id: 'base_link',
      body,
      initialTranslation: body.translation(),
      initialRotation: body.rotation(),
    },
  ];

  return {
    trackedBodies,
    revoluteMotors,
    prismaticMotors: new Map(),
    robotLinkNames: new Set(model.links.map((link) => link.name)),
    wheelVisualOffsets,
    kinematicDrive: true,
  };
}

export function buildRobotFromUrdf(
  R: typeof RAPIER,
  world: RAPIER.World,
  model: UrdfModel,
  spawn: Transform3D = DEFAULT_SPAWN,
): UrdfRobotBuildResult {
  if (isDiffDriveModel(model)) {
    return buildDiffDriveKinematic(R, world, model, spawn);
  }

  const linkTransforms = buildLinkTransforms(model, spawn);
  const bodies = new Map<string, RAPIER.RigidBody>();
  const trackedBodies: RapierTrackedBody[] = [];
  const revoluteMotors = new Map<string, RevoluteMotor>();
  const prismaticMotors = new Map<string, PrismaticMotor>();
  const robotLinkNames = new Set(model.links.map((link) => link.name));
  const root = findRootLink(model);

  for (const link of model.links) {
    const linkFrame = linkTransforms.get(link.name) ?? spawn;
    const collision = link.collision;
    const collisionOrigin = collision?.origin ?? { xyz: [0, 0, 0] as [number, number, number], rpy: [0, 0, 0] as [number, number, number] };
    const geometry = collision?.geometry;

    const bodyPose = collision
      ? composeTransforms(linkFrame, collisionOrigin)
      : linkFrame;

    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(bodyPose.xyz[0], bodyPose.xyz[1], bodyPose.xyz[2])
      .setRotation(rapierRotation(bodyPose.quat))
      .setCanSleep(false);

    if (link.name === root) {
      bodyDesc.enabledRotations(false, true, false);
    }

    if (!collision) {
      bodyDesc.setAdditionalMass(2.0);
    }

    const body = world.createRigidBody(bodyDesc);

    if (collision && geometry) {
      const colliderDesc = colliderFromGeometry(R, geometry, { xyz: [0, 0, 0], rpy: [0, 0, 0] });
      world.createCollider(colliderDesc, body);
    }
    bodies.set(link.name, body);

    trackedBodies.push({
      id: link.name,
      body,
      initialTranslation: body.translation(),
      initialRotation: body.rotation(),
    });
  }

  for (const joint of model.joints) {
    const parentBody = bodies.get(joint.parent);
    const childBody = bodies.get(joint.child);
    if (!parentBody || !childBody) continue;

    const parentFrame = linkTransforms.get(joint.parent) ?? IDENTITY;
    const axis = axisInParentFrame(joint.axis ?? [0, 0, 1], parentFrame.quat);
    const anchor = joint.origin.xyz;

    if (joint.type === 'revolute' || joint.type === 'continuous') {
      const impulseJoint = world.createImpulseJoint(
        R.JointData.revolute(
          { x: anchor[0], y: anchor[1], z: anchor[2] },
          { x: 0, y: 0, z: 0 },
          axis,
        ),
        parentBody,
        childBody,
        true,
      ) as RAPIER.RevoluteImpulseJoint;

      impulseJoint.configureMotorModel(R.MotorModel.ForceBased);
      revoluteMotors.set(joint.name, { joint: impulseJoint, targetVelocity: 0 });
    } else if (joint.type === 'prismatic') {
      const impulseJoint = world.createImpulseJoint(
        R.JointData.prismatic(
          { x: anchor[0], y: anchor[1], z: anchor[2] },
          { x: 0, y: 0, z: 0 },
          axis,
        ),
        parentBody,
        childBody,
        true,
      ) as RAPIER.PrismaticImpulseJoint;

      impulseJoint.configureMotorModel(R.MotorModel.ForceBased);
      prismaticMotors.set(joint.name, { joint: impulseJoint, targetVelocity: 0 });
    } else if (joint.type === 'fixed') {
      world.createImpulseJoint(
        R.JointData.fixed(
          { x: anchor[0], y: anchor[1], z: anchor[2] },
          rapierRotation(rpyToQuaternion(joint.origin.rpy)),
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
        parentBody,
        childBody,
        true,
      );
      if (joint.name.includes('wheel')) {
        revoluteMotors.set(joint.name, { targetVelocity: 0 });
      }
    }
  }

  return { trackedBodies, revoluteMotors, prismaticMotors, robotLinkNames };
}

export function buildGround(R: typeof RAPIER, world: RAPIER.World): RapierTrackedBody {
  const groundBody = world.createRigidBody(R.RigidBodyDesc.fixed());
  const ground = R.ColliderDesc.cuboid(20, 0.05, 20);
  ground.setFriction(1.0);
  ground.setRestitution(0.0);
  world.createCollider(ground, groundBody);
  return {
    id: 'ground',
    body: groundBody,
    initialTranslation: groundBody.translation(),
    initialRotation: groundBody.rotation(),
  };
}
