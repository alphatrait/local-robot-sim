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

export interface SimYamlConfig {
  version: number;
  robot: {
    urdf: string;
    spawn?: [number, number, number];
  };
  controller: {
    path: string;
    entrypoint: string;
    loop_hz: number;
    max_step_ms?: number;
    max_violations?: number;
  };
  simulation: {
    gravity: [number, number, number];
    physics_hz: number;
  };
  reload?: {
    policy: 'soft_reset' | 'preserve_physics' | 'pause_then_reset';
  };
  sync?: {
    mode: 'local' | 'github';
    poll_interval_sec?: number;
  };
}

export const DEFAULT_SIM_CONFIG: SimYamlConfig = {
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

export interface ProjectContext {
  /** Repo-relative path to the example/project folder containing sim.yaml. */
  root: string;
}

export const DEFAULT_PROJECT_CONTEXT: ProjectContext = { root: '' };

export interface WorkerInitMessage {
  type: 'INIT';
  pyodideIndexUrl: string;
  config: SimYamlConfig;
  robotModel: import('./urdf-parser').UrdfModel;
}

export interface WorkerLoadWorldMessage {
  type: 'LOAD_WORLD';
  config: SimYamlConfig;
  robotModel: import('./urdf-parser').UrdfModel;
}

export interface WorkerReloadControllerMessage {
  type: 'RELOAD_CONTROLLER';
  python: string;
  config: SimYamlConfig;
  softReset: boolean;
}

export interface WorkerSoftResetMessage {
  type: 'SOFT_RESET';
}

export type MainToWorkerMessage =
  | WorkerInitMessage
  | WorkerLoadWorldMessage
  | WorkerReloadControllerMessage
  | WorkerSoftResetMessage;

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

export type WorkerToMainMessage =
  | WorkerReadyMessage
  | WorkerWorldLoadedMessage
  | WorkerFrameMessage
  | WorkerLogMessage
  | WorkerControllerViolationMessage
  | WorkerControllerDisabledMessage
  | WorkerErrorMessage;

export interface SyncBundle {
  project: ProjectContext;
  config: SimYamlConfig;
  controllerPython: string;
  urdfXml: string;
  revision: string;
}
