import type RAPIER from '@dimforge/rapier3d-compat';
import type { WorldYamlConfig } from './types';
import type { RapierTrackedBody } from './urdf-rapier';

export function buildWorld(
  R: typeof RAPIER,
  world: RAPIER.World,
  envModel: WorldYamlConfig,
): RapierTrackedBody[] {
  const trackedBodies: RapierTrackedBody[] = [];
  const friction = envModel.physics.friction ?? 0.8;
  const [groundX, groundZ] = envModel.ground.size;
  const thickness = envModel.ground.thickness ?? 0.1;

  const groundBody = world.createRigidBody(R.RigidBodyDesc.fixed());
  const groundCollider = R.ColliderDesc.cuboid(groundX / 2, thickness / 2, groundZ / 2);
  groundCollider.setFriction(friction);
  groundCollider.setRestitution(0.0);
  world.createCollider(groundCollider, groundBody);
  trackedBodies.push({
    id: 'env:ground',
    body: groundBody,
    initialTranslation: groundBody.translation(),
    initialRotation: groundBody.rotation(),
  });

  for (const staticBody of envModel.static_bodies ?? []) {
    const [sx, sy, sz] = staticBody.size;
    const [px, py, pz] = staticBody.position;

    const body = world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(px, py, pz),
    );

    if (staticBody.shape === 'box') {
      const collider = R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
      collider.setFriction(friction);
      collider.setRestitution(0.0);
      world.createCollider(collider, body);
    }

    trackedBodies.push({
      id: `env:${staticBody.id}`,
      body,
      initialTranslation: body.translation(),
      initialRotation: body.rotation(),
    });
  }

  return trackedBodies;
}
