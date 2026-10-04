import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Field } from './Field';
afterEach(cleanup);

describe('Field', () => {
  it('generates an associated label/id and never spreads wrapper props onto the input', () => {
    render(<Field label="Credential" hint="Session only" mono className="custom" aria-describedby="external" />);
    const field = screen.getByLabelText('Credential');
    expect(field.id).toBeTruthy();
    expect(field.classList.contains('custom')).toBe(true);
    expect(field.getAttribute('aria-describedby')).toBe(`external ${field.id}-hint`);
    expect(document.getElementById(`${field.id}-hint`)?.textContent).toBe('Session only');
    for (const name of ['label', 'hint', 'error', 'mono', 'as']) expect(field.getAttribute(name)).toBeNull();
  });

  it('associates an error on a textarea while preserving native aria attributes', () => {
    render(<Field as="textarea" id="arguments" label="Arguments" error="Invalid object" aria-describedby="external" aria-required="true" />);
    const field = screen.getByLabelText('Arguments');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-required')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe('external arguments-error');
    expect(screen.getByRole('alert').id).toBe('arguments-error');
    expect(field.getAttribute('error')).toBeNull();
  });
});
