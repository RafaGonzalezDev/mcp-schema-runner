import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { builtinFixtures } from '../../../shared/fixtures.js';
import { isValidMcpServerConfig } from '../../../shared/types.js';
import { projectPath, projectRoot } from './projectPaths.js';
import { serverBuiltinFixtures } from './fixtures.js';

function fixtureById(id: string) {
  const fixture = builtinFixtures.find((item) => item.id === id);
  if (!fixture) throw new Error(`Missing built-in fixture: ${id}`);
  return fixture;
}

describe('built-in fixtures', () => {
  it('keeps unique valid ids without persisted environment values', () => {
    expect(new Set(builtinFixtures.map((fixture) => fixture.id)).size).toBe(builtinFixtures.length);
    for (const fixture of builtinFixtures) {
      expect(isValidMcpServerConfig(fixture)).toBe(true);
      expect(Object.keys(fixture.env ?? {})).toEqual([]);
      expect(fixture.envRefs).toBeUndefined();
      expect(fixture.sessionEnvKeys).toBeUndefined();
    }
  });

  it('ships an offline demo whose script resolves from the checkout root', () => {
    const demo = fixtureById('demo');
    const script = demo.args[0];
    expect(demo.command).toBe('node');
    expect(demo.transport).toBe('stdio');
    expect(typeof script).toBe('string');
    expect(existsSync(projectPath(script ?? ''))).toBe(true);
    const resolved = serverBuiltinFixtures.find((fixture) => fixture.id === 'demo');
    expect(resolved?.cwd).toBe(projectRoot);
    // Only the working directory is expanded; arguments stay literal.
    expect(resolved?.args).toEqual(demo.args);
    expect(resolved?.notes).toMatch(/no download or network access/i);
  });

  it('keeps third-party demos explicit about their downloads', () => {
    for (const id of ['filesystem', 'context7', 'playwright']) {
      const fixture = fixtureById(id);
      expect(fixture.command).toBe('npx');
      expect(fixture.args[0]).toBe('-y');
      expect(fixture.notes).toMatch(/download|network/i);
    }
  });
});
