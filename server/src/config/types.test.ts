import { describe, expect, it } from 'vitest';
import { isStringRecord, isValidAddServerConfig, isValidMcpServerConfig, publicConfig } from '../../../shared/types.js';
const config = { id: 'test', name: 'test', transport: 'stdio', command: 'test-server', args: [] };
describe('canonical stdio configuration', () => {
  it('accepts empty argument lists and preserves explicit empty arguments', () => {
    expect(isValidAddServerConfig(config)).toBe(true);
    expect(isValidAddServerConfig({ ...config, args: ['', ' padded '] })).toBe(true);
  });
  it.each([null, [], {}, { ...config, env: [] }, { ...config, notes: {} }, { ...config, source: 'hermes' }, { ...config, extra: true }, { ...config, command: ' ' }, { ...config, args: [2] }])('rejects invalid shape %#', (value) => {
    expect(isValidMcpServerConfig(value)).toBe(false);
  });
  it('validates references and forbids collisions', () => {
    expect(isValidAddServerConfig({ ...config, envRefs: { KEY: 'BACKEND_KEY' } })).toBe(true);
    expect(isValidAddServerConfig({ ...config, envRefs: { KEY: '${KEY}' } })).toBe(false);
    expect(isValidAddServerConfig({ ...config, envRefs: { KEY: 'REF' }, env: { KEY: 'literal' } })).toBe(false);
    expect(isValidAddServerConfig({ ...config, sessionEnvKeys: ['KEY'] })).toBe(false);
  });
  it('rejects NUL environment values for configuration and session replacement', () => {
    const env = { TOKEN: 'prefix\0suffix' };
    expect(isStringRecord(env)).toBe(false);
    expect(isValidAddServerConfig({ ...config, env })).toBe(false);
    expect(isValidMcpServerConfig({ ...config, env, sessionEnvKeys: ['TOKEN'] })).toBe(false);
    expect(isStringRecord({ TOKEN: '', MULTILINE: 'first\nsecond' })).toBe(true);
    expect(isValidAddServerConfig({ ...config, env: { TOKEN: '', MULTILINE: 'first\nsecond' } })).toBe(true);
  });
  it('rejects Windows environment collisions while preserving POSIX case sensitivity', () => {
    const configured = { ...config, envRefs: { TOKEN: 'SOURCE' }, env: { token: 'literal' } };
    expect(isValidAddServerConfig(configured, true)).toBe(false);
    expect(isValidAddServerConfig(configured, false)).toBe(true);
    expect(isValidAddServerConfig({ ...config, env: { TOKEN: 'first', token: 'second' } }, true)).toBe(false);
  });
  it('never publishes literal environment values', () => {
    const input = { ...config, transport: 'stdio' as const, env: { KEY: 'private-value' } };
    expect(publicConfig(input)).toEqual({ ...config, sessionEnvKeys: ['KEY'] });
  });
});
