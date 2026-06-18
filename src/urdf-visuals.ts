import * as THREE from 'three';
import type { UrdfGeometry, UrdfModel } from './urdf-parser';
import { composeTransforms, type Transform3D } from './urdf-math';

const DEFAULT_SPAWN: Transform3D = {
  xyz: [0, 0.25, 0],
  quat: [0, 0, 0, 1],
};

function findRootLink(model: UrdfModel): string {
  const childLinks = new Set(model.joints.map((joint) => joint.child));
  const roots = model.links.filter((link) => !childLinks.has(link.name));
  return roots.find((link) => link.name === 'base_link')?.name ?? roots[0]?.name ?? 'base_link';
}

function buildLinkTransforms(model: UrdfModel, spawn: Transform3D): Map<string, Transform3D> {
  const root = findRootLink(model);
  const jointsByParent = new Map<string, typeof model.joints>();
  for (const joint of model.joints) {
    const list = jointsByParent.get(joint.parent) ?? [];
    list.push(joint);
    jointsByParent.set(joint.parent, list);
  }

  const transforms = new Map<string, Transform3D>();
  const queue = [root];
  transforms.set(root, spawn);

  while (queue.length > 0) {
    const parentName = queue.shift()!;
    const parentTransform = transforms.get(parentName)!;
    for (const joint of jointsByParent.get(parentName) ?? []) {
      if (!transforms.has(joint.child)) {
        transforms.set(joint.child, composeTransforms(parentTransform, joint.origin));
        queue.push(joint.child);
      }
    }
  }

  return transforms;
}

function geometryFromUrdf(geometry: UrdfGeometry): THREE.BufferGeometry {
  switch (geometry.kind) {
    case 'box': {
      const [x, y, z] = geometry.size ?? [0.1, 0.1, 0.1];
      return new THREE.BoxGeometry(x, y, z);
    }
    case 'cylinder': {
      const radius = geometry.radius ?? 0.1;
      const length = geometry.length ?? 0.1;
      return new THREE.CylinderGeometry(radius, radius, length, 24);
    }
    case 'sphere':
      return new THREE.SphereGeometry(geometry.radius ?? 0.1, 24, 16);
    case 'mesh':
    default:
      return new THREE.BoxGeometry(0.2, 0.2, 0.2);
  }
}

function materialColor(model: UrdfModel, materialName?: string): THREE.Color {
  if (!materialName) return new THREE.Color(0x8ab4f8);
  const material = model.materials.find((entry) => entry.name === materialName);
  if (material?.color) {
    return new THREE.Color(material.color[0], material.color[1], material.color[2]);
  }
  return new THREE.Color(0x8ab4f8);
}

export function buildVisualsFromUrdf(
  model: UrdfModel,
  spawn: Transform3D = DEFAULT_SPAWN,
): Map<string, THREE.Object3D> {
  const linkTransforms = buildLinkTransforms(model, spawn);
  const visuals = new Map<string, THREE.Object3D>();

  for (const link of model.links) {
    const visual = link.visual;
    if (!visual) continue;

    const linkFrame = linkTransforms.get(link.name) ?? spawn;
    const meshPose = composeTransforms(linkFrame, visual.origin);
    const geometry = geometryFromUrdf(visual.geometry);
    const material = new THREE.MeshStandardMaterial({
      color: materialColor(model, visual.material),
      metalness: 0.15,
      roughness: 0.75,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(meshPose.xyz[0], meshPose.xyz[1], meshPose.xyz[2]);
    mesh.quaternion.set(meshPose.quat[0], meshPose.quat[1], meshPose.quat[2], meshPose.quat[3]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (visual.geometry.kind === 'cylinder') {
      mesh.rotateX(Math.PI / 2);
    }

    visuals.set(link.name, mesh);
  }

  return visuals;
}

export function disposeRobotVisuals(visuals: Map<string, THREE.Object3D>): void {
  for (const object of visuals.values()) {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
  visuals.clear();
}
