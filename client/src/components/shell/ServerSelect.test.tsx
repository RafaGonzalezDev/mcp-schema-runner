import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ServerSelect } from './ServerSelect';
import type { McpServerState } from '../../../../shared/types';
afterEach(cleanup);
const servers: McpServerState[] = ['alpha', 'beta', 'gamma'].map((id) => ({ config: { id, name: id, transport: 'stdio', command: 'node', args: [] }, status: 'disconnected', tools: [] }));

describe('ServerSelect keyboard pattern', () => {
  it('focuses the selected option, navigates with arrows/Home/End and returns focus on selection', () => {
    const onSelect = vi.fn();
    render(<ServerSelect servers={servers} selectedId="beta" onSelect={onSelect} />);
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    const options = screen.getAllByRole('option');
    expect(document.activeElement).toBe(options[1]);
    expect(options.map((option) => option.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(options[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(options[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0]!, { key: 'End' });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.click(options[2]!);
    expect(onSelect).toHaveBeenCalledWith('gamma');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens from ArrowDown, supports typeahead, closes on Escape and Tab', () => {
    render(<ServerSelect servers={servers} selectedId="beta" onSelect={vi.fn()} />);
    const trigger = screen.getByRole('button');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const alpha = screen.getAllByRole('option')[0]!;
    expect(document.activeElement).toBe(alpha);
    fireEvent.keyDown(alpha, { key: 'g' });
    expect(document.activeElement?.textContent).toContain('gamma');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
