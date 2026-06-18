/** Joins POSIX-style paths without relying on node:path (browser-safe). */
export function joinProjectPath(root: string, ...segments: string[]): string {
  const base = normalizeProjectRoot(root);
  const tail = segments
    .filter(Boolean)
    .join('/')
    .split('/')
    .filter(Boolean)
    .join('/');
  if (!base) return tail;
  if (!tail) return base;
  return `${base}/${tail}`;
}

export function normalizeProjectRoot(root: string): string {
  return root.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
