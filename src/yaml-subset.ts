/** Minimal YAML parser for flat config files (no external deps). */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function asVec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const [x, y, z] = value;
  if ([x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return [x, y, z];
  }
  return fallback;
}

export function asVec4(
  value: unknown,
  fallback: [number, number, number, number],
): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) return fallback;
  const [x, y, z, w] = value;
  if ([x, y, z, w].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return [x, y, z, w];
  }
  return fallback;
}

export function parseYamlSubset(raw: string): unknown {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [
    { indent: -1, obj: root },
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1].obj;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const valuePart = trimmed.slice(colonIndex + 1).trim();

    if (valuePart === '') {
      const child: Record<string, unknown> = {};
      current[key] = child;
      stack.push({ indent, obj: child });
      continue;
    }

    current[key] = parseScalar(valuePart);
  }

  return root;
}

function parseScalar(value: string): unknown {
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => parseScalar(part.trim()));
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  const num = Number(value);
  if (!Number.isNaN(num)) return num;

  return value;
}

export function parseYamlDocument(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYamlSubset(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label}: ${message}`);
  }

  const root = asRecord(parsed);
  if (!root) {
    throw new Error(`${label} root must be a mapping`);
  }
  return root;
}
