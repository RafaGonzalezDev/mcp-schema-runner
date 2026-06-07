import { describe, expect, it } from 'vitest';
import {
  exampleFromSchema,
  formatDuration,
  formatJson,
  parseJson,
} from './format';

describe('formatJson', () => {
  it('pretty-prints objects', () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
  it('returns fallback on circular reference', () => {
    const obj: Record<string, unknown> = {};
    obj['self'] = obj;
    expect(formatJson(obj, 'fallback')).toBe('fallback');
  });
});

describe('parseJson', () => {
  it('parses valid JSON', () => {
    const r = parseJson('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });
  it('treats empty text as empty object', () => {
    const r = parseJson('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });
  it('returns error on invalid JSON', () => {
    const r = parseJson('{');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

describe('exampleFromSchema', () => {
  it('returns {} for an object schema without properties', () => {
    expect(exampleFromSchema({ type: 'object' })).toBe('{}');
  });
  it('builds example for an object with properties', () => {
    const schema = {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
        recursive: { type: 'boolean' },
      },
    };
    const json = exampleFromSchema(schema);
    expect(JSON.parse(json)).toEqual({ path: '', recursive: false });
  });
  it('prefers example over default', () => {
    const schema = { type: 'object', properties: { x: { type: 'string', example: 'Y' } } };
    expect(JSON.parse(exampleFromSchema(schema))).toEqual({ x: 'Y' });
  });
  it('handles enum types', () => {
    const schema = { type: 'string', enum: ['a', 'b'] };
    expect(JSON.parse(exampleFromSchema(schema))).toBe('a');
  });
});

describe('formatDuration', () => {
  it('formats sub-second in ms', () => {
    expect(formatDuration(123)).toBe('123 ms');
  });
  it('formats seconds with two decimals', () => {
    expect(formatDuration(1450)).toBe('1.45 s');
  });
});
