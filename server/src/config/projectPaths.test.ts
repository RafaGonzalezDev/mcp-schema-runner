import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfigPath, findProjectRoot, projectRoot, projectPath } from './projectPaths.js';
import { withAbsolutePaths } from './expandPaths.js';
describe('project paths', () => {
  it('requires explicit choice for legacy root storage and never changes either file', () => {
    const root = mkdtempSync(join(tmpdir(), 'runner-paths-'));
    const legacy = join(root, '.data/servers.json');
    const expected = join(root, 'server/.data/servers.json');
    try {
      expect(defaultConfigPath(root)).toBe(expected);
      mkdirSync(join(root, '.data'), { recursive: true });
      writeFileSync(legacy, 'legacy-data');
      expect(() => defaultConfigPath(root)).toThrow('Set MCP_CONFIG_PATH explicitly');
      expect(readFileSync(legacy, 'utf8')).toBe('legacy-data');
      mkdirSync(join(root, 'server/.data'), { recursive: true });
      writeFileSync(expected, 'server-data');
      expect(() => defaultConfigPath(root)).toThrow('alongside server storage');
      expect(readFileSync(legacy, 'utf8')).toBe('legacy-data');
      expect(readFileSync(expected, 'utf8')).toBe('server-data');
    } finally {
      if (!resolve(root).startsWith(resolve(tmpdir(), 'runner-paths-'))) throw new Error('Unexpected temporary test directory');
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('finds the same root from source and emitted module layouts', () => {
    expect(findProjectRoot(join(projectRoot, 'server/src/config'))).toBe(projectRoot);
    expect(findProjectRoot(join(projectRoot, 'server/dist/server/src/config'))).toBe(projectRoot);
  });
  it('normalizes cwd without interpreting executable arguments', () => {
    const config = { id: 'test', name: 'test', transport: 'stdio' as const, command: 'node', args: ['./fixtures-workspace', 'fixtures-text', '', ' padded '] };
    expect(withAbsolutePaths(config)).toEqual({ ...config, cwd: projectRoot });
    expect(withAbsolutePaths({ ...config, cwd: 'fixtures-workspace' }).cwd).toBe(projectPath('fixtures-workspace'));
    expect(withAbsolutePaths({ ...config, cwd: projectRoot }).cwd).toBe(projectRoot);
  });
});
