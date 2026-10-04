import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Locate the private checkout root from either source or emitted modules. */
export function findProjectRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
      if (pkg.name === 'mcp-schema-runner') return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error('Cannot locate mcp-schema-runner project root');
    current = parent;
  }
}
export const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
export function projectPath(path: string): string {
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}
export function defaultConfigPath(root = projectRoot): string {
  const expected = resolve(root, 'server/.data/servers.json');
  const legacy = resolve(root, '.data/servers.json');
  if (existsSync(legacy)) {
    throw new Error(`Legacy root storage detected${existsSync(expected) ? ' alongside server storage' : ''}. Set MCP_CONFIG_PATH explicitly to choose the file; no files were changed.`);
  }
  return expected;
}
