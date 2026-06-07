import { useMemo, useState } from 'react';
import { Button } from '../components/primitives/Button';
import { ErrorBanner } from '../components/primitives/ErrorBanner';
import { JsonEditor } from '../components/traces/JsonEditor';
import { useAddServer, useServers } from '../lib/hooks';
import { parseJson } from '../lib/format';
import type { Route } from '../lib/router';
import styles from './HomePage.module.css';

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Configure a stdio MCP server',
    body: (
      <>
        A server is described by a JSON object with <code>command</code>,{' '}
        <code>args</code> and optionally <code>env</code> and <code>cwd</code>.
        The runner spawns it as a local subprocess and talks JSON-RPC over stdio.
      </>
    ),
  },
  {
    title: 'Connect from the app',
    body: (
      <>
        Pick a server in the inspector and press <code>connect</code>. The runner
        calls <code>initialize</code> and <code>tools/list</code> before listing
        the available tools.
      </>
    ),
  },
  {
    title: 'Inspect an inputSchema',
    body: (
      <>
        Click any tool in the right-hand panel to see its <code>inputSchema</code>.
        The runner pre-fills example arguments derived from the schema so you
        can iterate fast.
      </>
    ),
  },
  {
    title: 'Run and read the trace',
    body: (
      <>
        Edit the JSON arguments and press <code>run tool</code>. The execution
        trace shows the <code>request</code> sent, the <code>response</code> or{' '}
        <code>error</code> returned, the duration and the timestamp — exactly
        what an agent would see when invoking the tool.
      </>
    ),
  },
];

/**
 * Configuración de partida para el editor. Es la misma que la
 * fixture `filesystem`, útil como ejemplo y como punto de partida
 * para que el usuario solo tenga que cambiar `id` y `args`.
 */
const TEMPLATE_CONFIG = `{
  "id": "filesystem",
  "name": "filesystem",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "./fixtures-workspace"],
  "env": {},
  "cwd": ""
}`;

type Props = {
  onNavigate: (route: Route) => void;
  onSelectServer: (id: string) => void;
};

export function HomePage({ onNavigate, onSelectServer }: Props) {
  const { data: servers = [] } = useServers();
  const addServer = useAddServer();

  const [argsText, setArgsText] = useState<string>(TEMPLATE_CONFIG);
  const [localError, setLocalError] = useState<string | null>(null);

  const parsed = useMemo(() => parseJson(argsText), [argsText]);

  /**
   * Comprueba si el `id` del JSON parseado ya existe en la lista
   * de servidores (fixtures + store). Se calcula en cliente para
   * cortar el flujo antes de pegarle al backend; el backend acepta
   * duplicados, pero la UX es más clara con un error temprano.
   */
  const duplicateId = useMemo<string | null>(() => {
    if (!parsed.ok) return null;
    const value = parsed.value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const id = (value as Record<string, unknown>).id;
    if (typeof id !== 'string' || id.length === 0) return null;
    return servers.some((s) => s.config.id === id) ? id : null;
  }, [parsed, servers]);

  const errorMessage = localError ?? addServer.error?.message ?? null;
  const canSubmit = parsed.ok && !duplicateId && !addServer.isPending;

  const handleAdd = async () => {
    if (!parsed.ok) return;
    if (duplicateId) {
      setLocalError(`a server with id "${duplicateId}" already exists in your runner`);
      return;
    }
    setLocalError(null);
    try {
      const server = await addServer.mutateAsync(parsed.value);
      onSelectServer(server.config.id);
      onNavigate('inspector');
    } catch (err) {
      // El mensaje se propaga al ErrorBanner vía `addServer.error`.
      console.error('addServer failed', err);
    }
  };

  const handleDismissError = () => {
    setLocalError(null);
    addServer.reset();
  };

  const success = addServer.data;

  return (
    <div className={styles.home}>
      <header className={styles.hero}>
        <div className={styles.eyebrow}>mcp-schema-runner · v0.1</div>
        <h1 className={styles.title}>Debug stdio MCP servers locally.</h1>
        <p className={styles.lead}>
          Inspect tool schemas, execute manual tool calls and inspect raw
          request / response / error traces — everything you need to validate a
          Model Context Protocol server before plugging it into an agent.
        </p>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>How to test a server manually</h2>
          <span className={styles.sectionIndex}>01 — 04</span>
        </div>
        <ol className={styles.steps} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {STEPS.map((s, i) => (
            <li key={s.title} className={styles.step}>
              <span className={styles.stepIndex}>{String(i + 1).padStart(2, '0')}</span>
              <div className={styles.stepBody}>
                <span className={styles.stepTitle}>{s.title}</span>
                <span className={styles.stepText}>{s.body}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Add a server to your runner</h2>
          <span className={styles.sectionIndex}>05</span>
        </div>
        <p className={styles.stepText}>
          Paste a JSON config below to add a custom MCP server to your runner.
          The server is persisted to <code>server/.data/servers.json</code> and
          is available in the inspector immediately.
        </p>

        <ErrorBanner
          error={errorMessage}
          onDismiss={handleDismissError}
          resetKey={errorMessage ?? ''}
        />

        <div className={styles.formGroup}>
          <label htmlFor="add-server-config" className={styles.formLabel}>
            JSON config
          </label>
          <JsonEditor
            id="add-server-config"
            initial={argsText}
            onChange={setArgsText}
            hideSchemaButton
          />
          <div className={styles.formHint}>
            must include <code>id</code>, <code>name</code>,{' '}
            <code>transport: "stdio"</code>, <code>command</code>,{' '}
            <code>args[]</code>; <code>env</code> and <code>cwd</code> are
            optional
          </div>
        </div>

        <div className={styles.addActions}>
          <Button variant="primary" onClick={handleAdd} disabled={!canSubmit}>
            {addServer.isPending ? 'adding...' : 'add server'}
          </Button>
        </div>

        {success && (
          <div className={styles.success} role="status">
            <span className={styles.successDot} aria-hidden="true" />
            <span className={styles.successText}>
              <strong>{success.config.name}</strong> added to your runner.
            </span>
            <Button
              variant="ghost"
              compact
              onClick={() => {
                onSelectServer(success.config.id);
                onNavigate('inspector');
              }}
            >
              go to inspector
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
