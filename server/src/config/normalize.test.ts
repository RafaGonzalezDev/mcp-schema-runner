import { describe, expect, it } from 'vitest';
import {
  normalizeOpenCodeConfig,
  normalizeOpenCodeEntry,
  normalizeHermesConfig,
  normalizeHermesEntry,
} from './normalize.js';

describe('normalizeOpenCodeEntry', () => {
  it('normalizes a local entry into stdio config', () => {
    const result = normalizeOpenCodeEntry('context7', {
      type: 'local',
      command: ['npx', '-y', '@upstash/context7-mcp'],
      enabled: true,
    });
    expect(result.config).toEqual({
      id: 'opencode:context7',
      name: 'context7',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
      env: {},
      source: 'opencode',
    });
    expect(result.disabled).toBeUndefined();
    expect(result.skipped).toBeUndefined();
  });

  it('skips remote entries', () => {
    const result = normalizeOpenCodeEntry('atlassian', {
      type: 'remote',
      url: 'https://mcp.atlassian.com/v1/mcp',
      enabled: true,
    });
    expect(result.config).toBeUndefined();
    expect(result.skipped).toEqual({ reason: 'remote transport not supported in MVP' });
  });

  it('marks disabled entries', () => {
    const result = normalizeOpenCodeEntry('x', {
      type: 'local',
      command: ['npx', 'foo'],
      enabled: false,
    });
    expect(result.config).toBeUndefined();
    expect(result.disabled).toBe(true);
  });

  it('rejects empty command', () => {
    const result = normalizeOpenCodeEntry('x', { type: 'local', command: [] });
    expect(result.skipped).toBeDefined();
  });
});

describe('normalizeOpenCodeConfig', () => {
  it('handles full opencode shape', () => {
    const result = normalizeOpenCodeConfig({
      mcp: {
        context7: { type: 'local', command: ['npx', 'ctx'], enabled: true },
        playwright: { type: 'local', command: ['npx', 'pw'], enabled: true },
        atlassian: { type: 'remote', url: 'https://x', enabled: true },
        disabled_one: { type: 'local', command: ['npx', 'd'], enabled: false },
      },
    });
    const configs = result.map((r) => r.config?.name).filter(Boolean);
    expect(configs).toEqual(['context7', 'playwright']);
    const skipped = result.find((r) => r.skipped);
    expect(skipped?.skipped?.reason).toMatch(/remote/i);
    expect(result.find((r) => r.disabled)).toBeDefined();
  });

  it('returns empty for empty input', () => {
    expect(normalizeOpenCodeConfig({})).toEqual([]);
    expect(normalizeOpenCodeConfig({ mcp: {} })).toEqual([]);
  });
});

describe('normalizeHermesEntry', () => {
  it('normalizes a hermes entry with env', () => {
    const result = normalizeHermesEntry('context7', {
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
      env: { CONTEXT7_API_KEY: 'secret-value' },
    });
    expect(result.config).toEqual({
      id: 'hermes:context7',
      name: 'context7',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
      env: { CONTEXT7_API_KEY: '<redacted>' },
      source: 'hermes',
    });
  });

  it('handles missing args and env', () => {
    const result = normalizeHermesEntry('simple', { command: 'node' });
    expect(result.config).toEqual({
      id: 'hermes:simple',
      name: 'simple',
      transport: 'stdio',
      command: 'node',
      args: [],
      env: {},
      source: 'hermes',
    });
  });

  it('rejects invalid command', () => {
    const result = normalizeHermesEntry('x', { command: '' });
    expect(result.skipped).toBeDefined();
  });
});

describe('normalizeHermesConfig', () => {
  it('handles hermes shape', () => {
    const result = normalizeHermesConfig({
      mcp_servers: {
        context7: { command: 'npx', args: ['-y', 'ctx'] },
        other: { command: 'node', args: ['server.js'] },
      },
    });
    expect(result).toHaveLength(2);
    expect(result[0]?.config?.id).toBe('hermes:context7');
    expect(result[1]?.config?.id).toBe('hermes:other');
  });

  it('returns empty for empty input', () => {
    expect(normalizeHermesConfig({})).toEqual([]);
  });
});
