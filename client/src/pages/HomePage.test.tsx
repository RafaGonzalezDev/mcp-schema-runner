/**
 * Tests de HomePage.
 *
 * El objetivo no es probar TanStack Query ni el ciclo de vida del
 * `useMutation` (eso es territorio de la librería). Aquí verificamos
 * exclusivamente la composición de la UI:
 *
 *   - el template pre-rellena los campos del formulario
 *   - el botón se deshabilita ante campos vacíos o id duplicado
 *   - un submit válido llama a la API y, tras éxito, navega al
 *     inspector con el id recién añadido
 *   - un submit que la API rechaza (400 / red) muestra el mensaje
 *     en el ErrorBanner
 *   - el id se autoderiva del name hasta que el usuario lo edita
 *
 * Estrategia: mockear `lib/api` (la capa HTTP) y envolver con un
 * `QueryClient` real con la caché pre-poblada. Así `useServers` y
 * `useAddServer` ejercen su ciclo de vida real con datos
 * sincrónicos, y solo la red está bajo control del test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../lib/api', () => ({
  getHealth: vi.fn(),
  listServers: vi.fn(),
  addServer: vi.fn(),
  removeServer: vi.fn(),
  connectServer: vi.fn(),
  disconnectServer: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
}));

import * as api from '../lib/api';
import { qk } from '../lib/hooks';
import { HomePage } from './HomePage';
import type { McpServerState } from '../../../shared/types';

const mockListServers = vi.mocked(api.listServers);
const mockAddServerApi = vi.mocked(api.addServer);

function makeServer(id: string, name = id): McpServerState {
  return {
    config: {
      id,
      name,
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    },
    status: 'disconnected',
    tools: [],
  };
}

/**
 * Construye un `QueryClient` con la caché de `qk.servers`
 * pre-poblada. Esto hace que `useServers()` devuelva los datos
 * sincrónicamente en el primer render, evitando races en los
 * tests que dependen de la lista (duplicate-id detection).
 */
function makeWrapper(initialServers: McpServerState[] = []) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  qc.setQueryData(qk.servers, initialServers);
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

/**
 * Configura el mock de la API. Necesario porque la caché
 * pre-poblada puede ser invalidada por mutaciones o refetches
 * dentro de los tests.
 */
function setupServers(servers: McpServerState[] = []) {
  mockListServers.mockResolvedValue({ servers });
}

function getNameInput() {
  return screen.getByLabelText('name') as HTMLInputElement;
}
function getIdInput() {
  return screen.getByLabelText('id') as HTMLInputElement;
}
function getCommandInput() {
  return screen.getByLabelText('command') as HTMLInputElement;
}
function getArgsInput() {
  return screen.getByLabelText('arguments') as HTMLTextAreaElement;
}
function getCwdInput() {
  return screen.getByLabelText('working directory') as HTMLInputElement;
}
function getEnvInput() {
  return screen.getByLabelText('environment variables') as HTMLTextAreaElement;
}
function getSubmitButton() {
  return screen.getByRole('button', { name: /add server/i });
}

describe('HomePage', () => {
  let onNavigate: ReturnType<typeof vi.fn>;
  let onSelectServer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onNavigate = vi.fn();
    onSelectServer = vi.fn();
    setupServers();
    mockAddServerApi.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the tutorial steps and the add-server form', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByText('How to test a server manually')).toBeTruthy();
    expect(screen.getByText('Add a server to your runner')).toBeTruthy();
    expect(screen.getByText('Configure a stdio MCP server')).toBeTruthy();
    expect(screen.getByText('Connect from the app')).toBeTruthy();
  });

  it('pre-populates the form with a filesystem starter template', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    expect(getNameInput().value).toBe('filesystem');
    expect(getIdInput().value).toBe('filesystem');
    expect(getCommandInput().value).toBe('npx');
    expect(getArgsInput().value).toContain('@modelcontextprotocol/server-filesystem');
  });

  it('hides cwd and env behind a collapsed advanced section by default', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.queryByLabelText('working directory')).toBeNull();
    expect(screen.queryByLabelText('environment variables')).toBeNull();
    const toggle = screen.getByRole('button', { name: /advanced/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(getCwdInput()).toBeTruthy();
    expect(getEnvInput()).toBeTruthy();
  });

  it('disables submit when a required field is empty', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    fireEvent.change(getCommandInput(), { target: { value: '' } });
    const button = getSubmitButton();
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(mockAddServerApi).not.toHaveBeenCalled();
  });

  it('disables submit when arguments is empty', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    fireEvent.change(getArgsInput(), { target: { value: '' } });
    const button = getSubmitButton();
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(mockAddServerApi).not.toHaveBeenCalled();
  });

  it('disables submit when the id already exists', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper([makeServer('filesystem')]),
    });
    // El template tiene id "filesystem" que ya existe en la lista,
    // así que el botón debe estar deshabilitado desde el primer
    // render (sin necesidad de editar nada).
    const button = getSubmitButton();
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(mockAddServerApi).not.toHaveBeenCalled();
  });

  it('auto-derives the id from the name until the user edits the id', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    // Cambia el name: el id debe seguirle.
    fireEvent.change(getNameInput(), { target: { value: 'GitHub API' } });
    expect(getIdInput().value).toBe('github-api');

    // El usuario edita el id manualmente: a partir de ahí, el name
    // deja de tocar el id.
    fireEvent.change(getIdInput(), { target: { value: 'gh' } });
    fireEvent.change(getNameInput(), { target: { value: 'Other Name' } });
    expect(getIdInput().value).toBe('gh');
  });

  it('submits a valid config and navigates to the inspector on success', async () => {
    const newServer = makeServer('github', 'github');
    mockAddServerApi.mockResolvedValue({ server: newServer });

    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper([makeServer('context7')]),
    });
    fireEvent.change(getNameInput(), { target: { value: 'github' } });
    // El id se autoderiva, no hace falta tocarlo.
    fireEvent.change(getArgsInput(), {
      target: { value: '-y\n@modelcontextprotocol/server-github' },
    });

    const button = getSubmitButton();
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockAddServerApi).toHaveBeenCalledTimes(1);
    });
    // Lo que se envía a la API debe ser un McpServerConfig válido,
    // con transport fijo a "stdio" y args como array.
    const submitted = mockAddServerApi.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(submitted).toMatchObject({
      id: 'github',
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    });

    await waitFor(() => {
      expect(onSelectServer).toHaveBeenCalledWith('github');
    });
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('inspector');
    });

    // Importante: select antes de navigate, para que App monte el
    // InspectorPage con el id ya en su estado.
    const selectOrder = onSelectServer.mock.invocationCallOrder[0] as number;
    const navigateOrder = onNavigate.mock.invocationCallOrder[0] as number;
    expect(selectOrder).toBeLessThan(navigateOrder);
  });

  it('surfaces a server-side 400 error in the ErrorBanner', async () => {
    mockAddServerApi.mockRejectedValue(new Error('invalid McpServerConfig'));

    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    fireEvent.click(getSubmitButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('invalid McpServerConfig');
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onSelectServer).not.toHaveBeenCalled();
  });

  it('disables submit and skips the API call when the id collides after edit', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper([makeServer('github')]),
    });

    // name: github -> id autoderiva a "github" (ya existe en la lista).
    fireEvent.change(getNameInput(), { target: { value: 'github' } });
    expect(getIdInput().value).toBe('github');

    const button = getSubmitButton();
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(mockAddServerApi).not.toHaveBeenCalled();
  });

  it('shows the success card with a "go to inspector" CTA after a successful add', async () => {
    const newServer = makeServer('github', 'github');
    mockAddServerApi.mockResolvedValue({ server: newServer });

    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    fireEvent.click(getSubmitButton());

    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('github');
      expect(status.textContent).toContain('added to your runner');
    });

    fireEvent.click(screen.getByRole('button', { name: /go to inspector/i }));
    expect(onSelectServer).toHaveBeenCalledWith('github');
    expect(onNavigate).toHaveBeenCalledWith('inspector');
  });

  it('dismisses the error banner when the dismiss button is clicked', async () => {
    mockAddServerApi.mockRejectedValue(new Error('boom'));

    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    fireEvent.click(getSubmitButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('boom');
    });

    fireEvent.click(screen.getByRole('button', { name: /dismiss error/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('parses env text as KEY=value pairs and omits them when empty', async () => {
    const newServer = makeServer('daisy', 'daisy');
    mockAddServerApi.mockResolvedValue({ server: newServer });

    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    // Cambiamos a un id único para que el botón se habilite, y
    // abrimos "Advanced" para tocar env.
    fireEvent.change(getNameInput(), { target: { value: 'daisy' } });
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    fireEvent.change(getEnvInput(), {
      target: { value: 'LICENSE=\nEMAIL=user@example.com' },
    });
    fireEvent.click(getSubmitButton());

    await waitFor(() => {
      expect(mockAddServerApi).toHaveBeenCalledTimes(1);
    });
    const submitted = mockAddServerApi.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(submitted.env).toEqual({ LICENSE: '', EMAIL: 'user@example.com' });
  });
});
