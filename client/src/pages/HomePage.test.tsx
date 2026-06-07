/**
 * Tests de HomePage.
 *
 * El objetivo no es probar TanStack Query ni el ciclo de vida del
 * `useMutation` (eso es territorio de la librería). Aquí verificamos
 * exclusivamente la composición de la UI:
 *
 *   - el template pre-rellena el editor
 *   - el botón se deshabilita ante JSON inválido o id duplicado
 *   - un submit válido llama a la API y, tras éxito, navega al
 *     inspector con el id recién añadido
 *   - un submit que la API rechaza (400 / red) muestra el mensaje
 *     en el ErrorBanner
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

  it('pre-populates the editor with a starter template', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    const textarea = screen.getByLabelText('JSON config') as HTMLTextAreaElement;
    expect(textarea.value).toContain('filesystem');
    expect(textarea.value).toContain('"transport": "stdio"');
  });

  it('disables submit when the JSON is malformed', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    const textarea = screen.getByLabelText('JSON config');
    fireEvent.change(textarea, { target: { value: '{ not valid' } });
    const button = screen.getByRole('button', { name: /add server/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(mockAddServerApi).not.toHaveBeenCalled();
  });

  it('disables submit when the id already exists', () => {
    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper([makeServer('filesystem')]),
    });
    // El template tiene id "filesystem" que ya existe en la lista,
    // así que el botón debe estar deshabilitado desde el primer
    // render (sin necesidad de editar el JSON).
    const button = screen.getByRole('button', { name: /add server/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(mockAddServerApi).not.toHaveBeenCalled();
  });

  it('submits a valid config and navigates to the inspector on success', async () => {
    const newServer = makeServer('github', 'github');
    mockAddServerApi.mockResolvedValue({ server: newServer });

    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper([makeServer('context7')]),
    });
    const textarea = screen.getByLabelText('JSON config');
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({
          id: 'github',
          name: 'github',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        }),
      },
    });

    const button = screen.getByRole('button', { name: /add server/i });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockAddServerApi).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getByRole('button', { name: /add server/i }));

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

    const textarea = screen.getByLabelText('JSON config');
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({
          id: 'github',
          name: 'github',
          transport: 'stdio',
          command: 'npx',
          args: [],
        }),
      },
    });

    const button = screen.getByRole('button', { name: /add server/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(mockAddServerApi).not.toHaveBeenCalled();
  });

  it('shows the success card with a "go to inspector" CTA after a successful add', async () => {
    const newServer = makeServer('github', 'github');
    mockAddServerApi.mockResolvedValue({ server: newServer });

    render(<HomePage onNavigate={onNavigate} onSelectServer={onSelectServer} />, {
      wrapper: makeWrapper(),
    });
    fireEvent.click(screen.getByRole('button', { name: /add server/i }));

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
    fireEvent.click(screen.getByRole('button', { name: /add server/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('boom');
    });

    fireEvent.click(screen.getByRole('button', { name: /dismiss error/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
