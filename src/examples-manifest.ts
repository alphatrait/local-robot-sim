import { joinProjectPath, normalizeProjectRoot } from './project-path';

export interface ExampleEntry {
  id: string;
  path: string;
  label: string;
}

export interface ExamplesManifest {
  examples: ExampleEntry[];
}

export function parseExamplesManifest(raw: string): ExamplesManifest {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const examples: ExampleEntry[] = [];
  let current: Partial<ExampleEntry> | null = null;
  let inExamples = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed === 'examples:' || trimmed.startsWith('examples:')) {
      inExamples = true;
      continue;
    }

    if (!inExamples) continue;

    if (trimmed.startsWith('- ')) {
      if (current?.path) {
        examples.push(finalizeExample(current));
      }
      current = {};
      const inline = trimmed.slice(2).match(/^(\w+):\s*(.+)$/);
      if (inline) {
        applyExampleField(current, inline[1], inline[2]);
      }
      continue;
    }

    const match = trimmed.match(/^(\w+):\s*(.+)$/);
    if (!match || !current) continue;
    applyExampleField(current, match[1], match[2]);
  }

  if (current?.path) {
    examples.push(finalizeExample(current));
  }

  return { examples };
}

function applyExampleField(entry: Partial<ExampleEntry>, key: string, value: string): void {
  const cleaned = value.replace(/^["']|["']$/g, '');
  if (key === 'id') entry.id = cleaned;
  if (key === 'path') entry.path = normalizeProjectRoot(cleaned);
  if (key === 'label') entry.label = cleaned;
}

function finalizeExample(entry: Partial<ExampleEntry>): ExampleEntry {
  const path = normalizeProjectRoot(entry.path ?? '');
  const id = entry.id ?? path.split('/').pop() ?? 'example';
  return {
    id,
    path,
    label: entry.label ?? id,
  };
}

export async function fetchExamplesManifestFromGitHub(
  owner: string,
  repo: string,
  branch: string,
  token?: string,
): Promise<ExamplesManifest | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/examples.yaml`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  return parseExamplesManifest(await response.text());
}

export async function readExamplesManifestFromHandle(
  repoRoot: FileSystemDirectoryHandle,
): Promise<ExamplesManifest | null> {
  try {
    const fileHandle = await repoRoot.getFileHandle('examples.yaml');
    const file = await fileHandle.getFile();
    return parseExamplesManifest(await file.text());
  } catch {
    return null;
  }
}

export function resolveExamplePaths(
  projectRoot: string,
  configPaths: { urdf: string; controller: string },
): { urdf: string; controller: string; simYaml: string } {
  return {
    simYaml: joinProjectPath(projectRoot, 'sim.yaml'),
    urdf: joinProjectPath(projectRoot, configPaths.urdf),
    controller: joinProjectPath(projectRoot, configPaths.controller),
  };
}
