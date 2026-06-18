export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface BodyTransform {
  id: string;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface ControllerConfig {
  path: string;
  entrypoint: string;
  loop_hz: number;
  max_step_ms?: number;
  max_violations?: number;
}

export interface SpawnConfig {
  position: [number, number, number];
  rotation?: [number, number, number, number];
}

export interface ReloadConfig {
  policy: 'soft_reset' | 'preserve_physics' | 'pause_then_reset';
}

export interface SyncConfig {
  mode: 'local' | 'github';
  poll_interval_sec?: number;
}

export interface SimYamlConfigV1 {
  version: number;
  robot: {
    urdf: string;
    spawn?: [number, number, number];
  };
  controller: ControllerConfig;
  simulation: {
    gravity: [number, number, number];
    physics_hz: number;
  };
  reload?: ReloadConfig;
  sync?: SyncConfig;
}

export interface SimYamlConfigV2 {
  version: 2;
  environment?: string;
  robot?: string;
  spawn: SpawnConfig;
  controller?: Partial<ControllerConfig>;
  simulation: {
    physics_hz: number;
  };
  reload?: ReloadConfig;
  sync?: SyncConfig;
}

export type SimConfig = SimYamlConfigV1 | SimYamlConfigV2;

/** @deprecated Use SimConfig — kept for gradual migration. */
export type SimYamlConfig = SimConfig;

export const DEFAULT_SIM_CONFIG: SimYamlConfigV1 = {
  version: 1,
  robot: { urdf: 'robot/demo_mobile.urdf', spawn: [0, 0.25, 0] },
  controller: {
    path: 'controllers/main.py',
    entrypoint: 'main',
    loop_hz: 60,
    max_step_ms: 8,
    max_violations: 3,
  },
  simulation: {
    gravity: [0, -9.81, 0],
    physics_hz: 60,
  },
  reload: { policy: 'soft_reset' },
};

export type DriveModel = 'auto' | 'diff_drive' | 'articulated';

export interface StaticBodyConfig {
  id: string;
  shape: 'box';
  size: [number, number, number];
  position: [number, number, number];
}

export interface EnvVisualsConfig {
  grid_size?: number;
  fog_color?: number;
  ground_color?: number;
}

export interface WorldYamlConfig {
  version: number;
  name?: string;
  physics: {
    gravity: [number, number, number];
    friction?: number;
  };
  ground: {
    size: [number, number];
    thickness?: number;
  };
  static_bodies?: StaticBodyConfig[];
  visuals?: EnvVisualsConfig;
}

export interface RobotYamlConfig {
  version: number;
  name?: string;
  drive_model?: DriveModel;
}

export interface ProjectContext {
  /** Repo-relative path to the example/project folder containing sim.yaml. */
  root: string;
}

export const DEFAULT_PROJECT_CONTEXT: ProjectContext = { root: '' };

export interface WorkerInitMessage {
  type: 'INIT';
  pyodideIndexUrl: string;
  config: SimConfig;
  envModel?: WorldYamlConfig;
  robotModel: import('./urdf-parser').UrdfModel;
  robotMeta?: RobotYamlConfig;
}

export interface WorkerLoadWorldMessage {
  type: 'LOAD_WORLD';
  config: SimConfig;
  envModel?: WorldYamlConfig;
  robotModel: import('./urdf-parser').UrdfModel;
  robotMeta?: RobotYamlConfig;
}

export interface WorkerReloadControllerMessage {
  type: 'RELOAD_CONTROLLER';
  python: string;
  config: SimConfig;
  softReset: boolean;
}

export interface WorkerSoftResetMessage {
  type: 'SOFT_RESET';
}

export interface WorkerSetPausedMessage {
  type: 'SET_PAUSED';
  paused: boolean;
}

export type MainToWorkerMessage =
  | WorkerInitMessage
  | WorkerLoadWorldMessage
  | WorkerReloadControllerMessage
  | WorkerSoftResetMessage
  | WorkerSetPausedMessage;

export interface WorkerReadyMessage {
  type: 'READY';
  rapierReady: boolean;
  pyodideReady: boolean;
}

export interface WorkerWorldLoadedMessage {
  type: 'WORLD_LOADED';
  linkNames: string[];
}

export interface WorkerFrameMessage {
  type: 'FRAME';
  bodies: BodyTransform[];
  simTime: number;
}

export interface WorkerLogMessage {
  type: 'LOG';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface WorkerControllerViolationMessage {
  type: 'CONTROLLER_VIOLATION';
  durationMs: number;
  violations: number;
  maxViolations: number;
}

export interface WorkerControllerDisabledMessage {
  type: 'CONTROLLER_DISABLED';
  reason: string;
}

export interface WorkerErrorMessage {
  type: 'ERROR';
  message: string;
}

export interface WorkerPausedMessage {
  type: 'PAUSED';
  paused: boolean;
}

export type WorkerToMainMessage =
  | WorkerReadyMessage
  | WorkerWorldLoadedMessage
  | WorkerFrameMessage
  | WorkerLogMessage
  | WorkerControllerViolationMessage
  | WorkerControllerDisabledMessage
  | WorkerErrorMessage
  | WorkerPausedMessage;

export interface SyncBundle {
  project: ProjectContext;
  config: SimConfig;
  envYaml?: string;
  envModel?: WorldYamlConfig;
  urdfXml: string;
  robotMeta?: RobotYamlConfig;
  robotMetaYaml?: string;
  controllerPython: string;
  controllerSource: 'scenario' | 'bot' | 'none';
  resolvedPaths: {
    environment?: string;
    robotUrdf: string;
    controller: string;
  };
  revision: string;
}
