import * as THREE from 'three';
import type { WorldYamlConfig } from './types';

export interface EnvVisualBuildResult {
  group: THREE.Group;
  dispose: () => void;
}

const LEGACY_VISUALS = {
  grid_size: 40,
  fog_color: 0x0f1117,
  ground_color: 0x151922,
};

export function buildLegacyEnvVisuals(): EnvVisualBuildResult {
  return buildEnvVisuals({
    version: 1,
    physics: { gravity: [0, -9.81, 0] },
    ground: { size: [40, 40], thickness: 0.1 },
    visuals: LEGACY_VISUALS,
  });
}

export function buildEnvVisuals(envModel: WorldYamlConfig): EnvVisualBuildResult {
  const group = new THREE.Group();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  const visuals = envModel.visuals ?? {};
  const gridSize = visuals.grid_size ?? Math.max(envModel.ground.size[0], envModel.ground.size[1]);
  const groundColor = visuals.ground_color ?? 0x151922;
  const [groundX, groundZ] = envModel.ground.size;

  const grid = new THREE.GridHelper(gridSize, gridSize, 0x3a4254, 0x252b36);
  group.add(grid);

  const groundGeometry = new THREE.PlaneGeometry(groundX, groundZ);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: groundColor,
    roughness: 0.95,
  });
  disposables.push(groundGeometry, groundMaterial);

  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  for (const staticBody of envModel.static_bodies ?? []) {
    if (staticBody.shape !== 'box') continue;

    const [sx, sy, sz] = staticBody.size;
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a5568,
      roughness: 0.85,
      metalness: 0.05,
    });
    disposables.push(geometry, material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(staticBody.position[0], staticBody.position[1], staticBody.position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return {
    group,
    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}

export function applyEnvVisualSettings(
  scene: THREE.Scene,
  envModel?: WorldYamlConfig,
): void {
  const fogColor = envModel?.visuals?.fog_color ?? LEGACY_VISUALS.fog_color;
  scene.background = new THREE.Color(fogColor);
  scene.fog = new THREE.Fog(fogColor, 20, 80);
}
