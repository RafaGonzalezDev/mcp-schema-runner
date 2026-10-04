const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type ParseResult = { ok: true; values: Record<string, string> } | { ok: false; error: string };

/** Validation messages never include user-provided values. */
export function parseEnvironment(text: string, references = false): ParseResult {
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [index, raw] of text.split('\n').entries()) {
    if (!raw.trim()) continue;
    const separator = raw.indexOf('=');
    const key = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1);
    if (separator < 1 || !NAME.test(key) || (references && !NAME.test(value.trim()))) {
      return { ok: false, error: `Line ${index + 1}: expected ${references ? 'KEY=BACKEND_VARIABLE' : 'KEY=value'} with a valid variable name.` };
    }
    if (Object.hasOwn(values, key)) return { ok: false, error: `Line ${index + 1}: duplicate variable name.` };
    values[key] = references ? value.trim() : value;
  }
  return { ok: true, values };
}
