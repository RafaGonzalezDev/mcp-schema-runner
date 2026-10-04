import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { McpServerState } from '../../../shared/types';

vi.mock('../lib/api', () => ({ listServers: vi.fn(), addServer: vi.fn(), migrateConfig: vi.fn() }));
import * as api from '../lib/api';
import { qk } from '../lib/hooks';
import { HomePage } from './HomePage';

const server = (id: string, builtin = false): McpServerState => ({ config: { id, name: id, transport: 'stdio', command: 'node', args: [] }, status: 'disconnected', tools: [], ...(builtin ? { builtin: true } : {}) });
let clients: QueryClient[] = [];
function wrapper(servers: McpServerState[] = [], migrationPending = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  client.setQueryData(qk.servers, { servers, migrationPending });
  vi.mocked(api.listServers).mockResolvedValue({ servers, migrationPending });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const submit = () => screen.getByRole('button', { name: 'add server' });
const change = (name: string, value: string) => fireEvent.change(input(name), { target: { value } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.addServer).mockResolvedValue({ server: server('new-server') });
});
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients = []; });

function mount(servers: McpServerState[] = [], pending = false) {
  const onNavigate = vi.fn();
  const onSelectServer = vi.fn();
  render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, { wrapper: wrapper(servers, pending) });
  return { onNavigate, onSelectServer };
}

describe('HomePage', () => {
  it('renders the starter fields with accessible labels and linked hints', () => {
    mount();
    expect(input('name').value).toBe('my-server');
    expect(input('command').value).toBe('node');
    expect(input('arguments').getAttribute('aria-describedby')).toBeTruthy();
    expect(input('name').getAttribute('label')).toBeNull();
    expect(input('name').getAttribute('hint')).toBeNull();
    expect(input('name').getAttribute('required')).not.toBeNull();
  });

  it('submits the untouched starter because its id is not a reserved built-in', async () => {
    mount([server('demo', true), server('filesystem', true)]);
    fireEvent.click(submit());
    expect(input('id').getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText(/choose a unique id/)).toBeNull();
    await waitFor(() => expect(api.addServer).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.addServer).mock.calls[0]?.[0]).toMatchObject({ id: 'my-server', command: 'node', args: ['server/examples/demo-server.mjs'] });
  });

  it('explains that a built-in demo id is reserved', () => {
    mount([server('demo', true)]);
    change('id', 'demo');
    fireEvent.click(submit());
    expect(screen.getByText(/reserved by a built-in demo/)).toBeTruthy();
    expect(api.addServer).not.toHaveBeenCalled();
  });

  it('permits an executable without arguments and navigates after saving', async () => {
    const { onNavigate, onSelectServer } = mount();
    change('name', 'new-server');
    change('arguments', '');
    fireEvent.click(submit());
    await waitFor(() => expect(api.addServer).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.addServer).mock.calls[0]?.[0].args).toEqual([]);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('inspector'));
    expect(onSelectServer).toHaveBeenCalledWith('new-server');
  });

  it('shows validation on blur, not while typing, and focuses the first submit error', () => {
    mount();
    change('name', '');
    expect(input('name').getAttribute('aria-invalid')).toBeNull();
    fireEvent.blur(input('name'));
    expect(input('name').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(submit());
    expect(document.activeElement).toBe(input('name'));
    expect(api.addServer).not.toHaveBeenCalled();
    change('name', 'valid');
    expect(input('name').getAttribute('aria-invalid')).toBeNull();
  });

  it('rejects duplicate ids on submit without disabling initial validation', () => {
    mount([server('filesystem')]);
    change('id', 'filesystem');
    expect((submit() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit());
    expect(screen.getByText(/this id is already configured/)).toBeTruthy();
    expect(document.activeElement).toBe(input('id'));
    expect(api.addServer).not.toHaveBeenCalled();
  });

  it('derives the id from name until the user edits it', () => {
    mount();
    change('name', 'My Server');
    expect(input('id').value).toBe('my-server');
    change('id', 'custom');
    change('name', 'Another Server');
    expect(input('id').value).toBe('custom');
  });

  it('submits session values separately from persisted backend references', async () => {
    mount();
    change('name', 'new-server');
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    change('environment variables', 'TOKEN=session-secret\nEMPTY=');
    change('environment references', 'API_KEY=BACKEND_TOKEN');
    fireEvent.click(submit());
    await waitFor(() => expect(api.addServer).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.addServer).mock.calls[0]?.[0]).toMatchObject({ env: { TOKEN: 'session-secret', EMPTY: '' }, envRefs: { API_KEY: 'BACKEND_TOKEN' } });
    await waitFor(() => expect(input('environment variables').value).toBe(''));
    expect(screen.queryByText('session-secret')).toBeNull();
  });

  it('does not echo environment values in validation errors and preserves input', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    change('environment variables', 'invalid secret-never-echo');
    fireEvent.blur(input('environment variables'));
    expect(screen.getByRole('alert').textContent).not.toContain('secret-never-echo');
    expect(input('environment variables').value).toBe('invalid secret-never-echo');
    expect(input('environment variables').getAttribute('error')).toBeNull();
  });

  it('rejects overlapping session and referenced variable names', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    change('environment variables', 'TOKEN=secret');
    change('environment references', 'TOKEN=BACKEND_TOKEN');
    fireEvent.click(submit());
    expect(screen.getByText(/not both/)).toBeTruthy();
    expect(api.addServer).not.toHaveBeenCalled();
  });

  it('preserves form values and API error until explicitly dismissed', async () => {
    vi.mocked(api.addServer).mockRejectedValue(new Error('Cannot save configuration. Try again.'));
    mount();
    change('name', 'new-server');
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Cannot save configuration'));
    expect(input('name').value).toBe('new-server');
    fireEvent.click(screen.getByRole('button', { name: 'dismiss error' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('blocks operations until migration is explicitly reviewed and confirmed', async () => {
    mount([], true);
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    expect(api.migrateConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'review migration' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'cancel' }));
    vi.mocked(api.listServers).mockResolvedValue({ servers: [], migrationPending: false });
    vi.mocked(api.migrateConfig).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'confirm migration' }));
    await waitFor(() => expect(api.migrateConfig).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((submit() as HTMLButtonElement).disabled).toBe(false);
  });
});
