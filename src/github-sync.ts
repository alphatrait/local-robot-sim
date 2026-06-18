import type { ProjectContext, SyncBundle } from './types';
import { joinProjectPath } from './project-path';
import { loadSimulationBundle, type SimulationFileReader } from './sim-loader';

export interface GitHubSyncOptions {
  owner: string;
  repo: string;
  branch?: string;
  token?: string;
  pollIntervalSec?: number;
  projectRoot?: string;
}

export interface LocalSyncOptions {
  /** Repository root selected via File System Access API. */
  repoHandle: FileSystemDirectoryHandle;
  /** Project subpath inside the repo, e.g. "simulations/diff-drive". */
  projectRoot?: string;
}

type SyncListener = (bundle: SyncBundle) => void;
type LogListener = (message: string, level?: 'info' | 'warn' | 'error') => void;

const DEFAULT_POLL_SEC = 15;

async function readFileFromHandle(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<string> {
  const parts = relativePath.split('/').filter(Boolean);
  let dir = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  return file.text();
}

async function fileExistsInHandle(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<boolean> {
  try {
    await readFileFromHandle(root, relativePath);
    return true;
  } catch {
    return false;
  }
}

function rawGitHubUrl(owner: string, repo: string, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

function buildHeaders(token?: string, etag?: string): HeadersInit {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers['If-None-Match'] = etag;
  return headers;
}

function projectContext(root: string): ProjectContext {
  return { root };
}

/**
 * Fetches project files from a public GitHub repo using raw URLs with ETag caching.
 */
export class GitHubSync {
  readonly options: Required<Omit<GitHubSyncOptions, 'token' | 'projectRoot'>> & {
    token?: string;
    projectRoot: string;
  };

  private etag: string | null = null;
  private revision = '';
  private pollTimer: number | null = null;
  private listeners = new Set<SyncListener>();
  private logListeners = new Set<LogListener>();

  constructor(options: GitHubSyncOptions) {
    this.options = {
      owner: options.owner,
      repo: options.repo,
      branch: options.branch ?? 'main',
      token: options.token,
      pollIntervalSec: options.pollIntervalSec ?? DEFAULT_POLL_SEC,
      projectRoot: options.projectRoot ?? '',
    };
  }

  setProjectRoot(root: string): void {
    this.options.projectRoot = root;
    this.revision = '';
    this.etag = null;
  }

  onBundle(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  startPolling(): void {
    this.stopPolling();
    void this.pollOnce();
    this.pollTimer = window.setInterval(() => {
      void this.pollOnce();
    }, this.options.pollIntervalSec * 1000);
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollOnce(): Promise<SyncBundle | null> {
    const simYamlPath = joinProjectPath(this.options.projectRoot, 'sim.yaml');
    const shaPath = joinProjectPath(this.options.projectRoot, '.sim-sha');
    const shaUrl = rawGitHubUrl(this.options.owner, this.options.repo, this.options.branch, shaPath);

    try {
      const shaResponse = await fetch(shaUrl, {
        headers: buildHeaders(this.options.token, this.etag ?? undefined),
      });

      if (shaResponse.status === 304) {
        return null;
      }

      if (!shaResponse.ok) {
        return this.fetchBundleViaSimYaml(simYamlPath);
      }

      const nextEtag = shaResponse.headers.get('ETag');
      if (nextEtag) this.etag = nextEtag;

      const revision = (await shaResponse.text()).trim();
      if (revision === this.revision) return null;

      const bundle = await this.fetchBundle(revision, simYamlPath);
      this.revision = revision;
      this.emit(bundle);
      return bundle;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`GitHub sync failed: ${message}`, 'error');
      return null;
    }
  }

  async readOnce(): Promise<SyncBundle> {
    const bundle = await loadSimulationBundle(
      projectContext(this.options.projectRoot),
      this.createReader(),
    );
    this.revision = bundle.revision;
    return bundle;
  }

  private createReader(): SimulationFileReader {
    return {
      readText: (path) => this.fetchRaw(path),
      exists: async (path) => {
        try {
          await this.fetchRaw(path);
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  private async fetchBundleViaSimYaml(simYamlPath: string): Promise<SyncBundle | null> {
    const simYamlUrl = rawGitHubUrl(
      this.options.owner,
      this.options.repo,
      this.options.branch,
      simYamlPath,
    );

    const response = await fetch(simYamlUrl, {
      headers: buildHeaders(this.options.token, this.etag ?? undefined),
    });

    if (response.status === 304) return null;
    if (!response.ok) {
      throw new Error(`sim.yaml fetch failed at ${simYamlPath} (${response.status})`);
    }

    const nextEtag = response.headers.get('ETag');
    if (nextEtag) this.etag = nextEtag;

    const bundle = await loadSimulationBundle(
      projectContext(this.options.projectRoot),
      this.createReader(),
    );
    const revision = `${this.options.branch}:${bundle.revision}`;
    if (revision === this.revision) return null;

    bundle.revision = revision;
    this.revision = revision;
    this.emit(bundle);
    return bundle;
  }

  private async fetchBundle(revision: string, _simYamlPath: string): Promise<SyncBundle> {
    const bundle = await loadSimulationBundle(
      projectContext(this.options.projectRoot),
      this.createReader(),
    );
    return {
      ...bundle,
      revision,
    };
  }

  private async fetchRaw(path: string): Promise<string> {
    const url = rawGitHubUrl(this.options.owner, this.options.repo, this.options.branch, path);
    const response = await fetch(url, { headers: buildHeaders(this.options.token) });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path} (${response.status})`);
    }
    return response.text();
  }

  private emit(bundle: SyncBundle): void {
    for (const listener of this.listeners) listener(bundle);
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    for (const listener of this.logListeners) listener(message, level);
  }
}

/**
 * Watches a local repository via File System Access API.
 * Reads example files relative to repo root + projectRoot.
 */
export class LocalFolderSync {
  private repoHandle: FileSystemDirectoryHandle;
  private projectRoot: string;
  private revision = '';
  private pollTimer: number | null = null;
  private listeners = new Set<SyncListener>();
  private logListeners = new Set<LogListener>();

  constructor(options: LocalSyncOptions) {
    this.repoHandle = options.repoHandle;
    this.projectRoot = options.projectRoot ?? '';
  }

  setProjectRoot(root: string): void {
    this.projectRoot = root;
    this.revision = '';
  }

  onBundle(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  startWatching(intervalMs = 500): void {
    this.stopWatching();
    void this.pollOnce();
    this.pollTimer = window.setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  stopWatching(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollOnce(): Promise<SyncBundle | null> {
    try {
      const simYamlPath = joinProjectPath(this.projectRoot, 'sim.yaml');
      const hasSimYaml = await fileExistsInHandle(this.repoHandle, simYamlPath);
      if (!hasSimYaml) {
        this.log(`sim.yaml not found at ${simYamlPath || '(repo root)'}`, 'warn');
        return null;
      }

      const bundle = await this.readOnce();
      if (bundle.revision === this.revision) return null;

      this.revision = bundle.revision;
      this.emit(bundle);
      this.log(`Local reload ${simYamlPath}`, 'info');
      return bundle;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Local sync failed: ${message}`, 'error');
      return null;
    }
  }

  async readOnce(): Promise<SyncBundle> {
    return loadSimulationBundle(projectContext(this.projectRoot), {
      readText: (path) => readFileFromHandle(this.repoHandle, path),
      exists: (path) => fileExistsInHandle(this.repoHandle, path),
    });
  }

  private emit(bundle: SyncBundle): void {
    for (const listener of this.listeners) listener(bundle);
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    for (const listener of this.logListeners) listener(message, level);
  }
}

export function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, '') };

  const slugMatch = trimmed.match(/^([^/]+)\/([^/]+)$/);
  if (slugMatch) return { owner: slugMatch[1], repo: slugMatch[2] };

  return null;
}

export async function pickProjectFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('File System Access API is not supported in this browser');
  }
  return window.showDirectoryPicker({ mode: 'read' });
}
