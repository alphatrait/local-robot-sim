import { normalizeProjectRoot } from './project-path';
import { loadSimulationBundle, type SimulationFileReader } from './sim-loader';
import type { SyncBundle } from './types';

function bundledBaseUrl(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

export function createHttpSimulationReader(): SimulationFileReader {
  const baseUrl = bundledBaseUrl();

  return {
    async readText(path: string): Promise<string> {
      const url = `${baseUrl}${path}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${path} (${response.status})`);
      }
      return response.text();
    },
    async exists(path: string): Promise<boolean> {
      const url = `${baseUrl}${path}`;
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    },
  };
}

export async function loadBundledSimulation(projectRoot: string): Promise<SyncBundle> {
  const root = normalizeProjectRoot(projectRoot);
  return loadSimulationBundle({ root }, createHttpSimulationReader());
}
