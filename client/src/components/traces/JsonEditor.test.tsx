import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { JsonEditor } from './JsonEditor';
afterEach(cleanup);

describe('JsonEditor', () => {
  it('does not overwrite a controlled draft when the schema changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(<JsonEditor value='{"manual":true}' schema={{ type: 'object' }} onChange={onChange} />);
    rerender(<JsonEditor value='{"manual":true}' schema={{ type: 'object', properties: { changed: { type: 'string' } } }} onChange={onChange} />);
    expect((screen.getByLabelText('Tool arguments (JSON)') as HTMLTextAreaElement).value).toBe('{"manual":true}');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'from schema' }));
    expect(onChange).toHaveBeenCalledWith('{\n  "changed": ""\n}');
  });

  it('formats and clears through the parent, with an accessible object validation error', () => {
    function Harness() {
      const [value, setValue] = useState('{"x":1}');
      return <JsonEditor value={value} onChange={setValue} />;
    }
    render(<Harness />);
    const editor = screen.getByLabelText('Tool arguments (JSON)') as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: 'format' }));
    expect(editor.value).toBe('{\n  "x": 1\n}');
    fireEvent.change(editor, { target: { value: '[]' } });
    expect(editor.getAttribute('aria-invalid')).toBe('false');
    fireEvent.blur(editor);
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(editor.getAttribute('aria-describedby') ?? '')?.textContent).toContain('JSON object');
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(editor.value).toBe('');
    expect(editor.getAttribute('aria-invalid')).toBe('false');
  });
});
