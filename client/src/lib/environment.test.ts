import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './environment';
describe('environment parsing', () => {
  it('preserves empty values and equals signs without trimming secret content', () => {
    expect(parseEnvironment('API_KEY= secret=token \nEMPTY=')).toEqual({ ok: true, values: { API_KEY: ' secret=token ', EMPTY: '' } });
  });
  it('validates references as backend variable names and rejects duplicate names', () => {
    expect(parseEnvironment('TOKEN=BACKEND_TOKEN', true)).toEqual({ ok: true, values: { TOKEN: 'BACKEND_TOKEN' } });
    expect(parseEnvironment('TOKEN=value with spaces', true).ok).toBe(false);
    expect(parseEnvironment('TOKEN=a\nTOKEN=b').ok).toBe(false);
  });
  it('never includes invalid values in error messages', () => {
    const result = parseEnvironment('bad-key=secret-value');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain('secret-value');
  });
});
