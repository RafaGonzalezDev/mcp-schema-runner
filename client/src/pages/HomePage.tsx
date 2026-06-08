import { useMemo, useState } from 'react';
import { Button } from '../components/primitives/Button';
import { ErrorBanner } from '../components/primitives/ErrorBanner';
import { Field } from '../components/primitives/Field';
import { useAddServer, useServers } from '../lib/hooks';
import type { McpServerConfig } from '../../../shared/types';
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
 * Starter values for the form. Reuses the same shape as the
 * `filesystem` fixture, so the user only has to change the id
 * (or the name) to add their own MCP server.
 */
const TEMPLATE_FORM = {
  name: 'filesystem',
  id: 'filesystem',
  command: 'npx',
  argsText: '-y\n@modelcontextprotocol/server-filesystem\n./fixtures-workspace',
  cwd: '',
  envText: '',
} as const;

type FormState = {
  name: string;
  id: string;
  command: string;
  argsText: string;
  cwd: string;
  envText: string;
};

type Props = {
  onNavigate: (route: Route) => void;
  onSelectServer: (id: string) => void;
};

/** Parses a one-argument-per-line textarea into a string[]. Blank lines are dropped. */
function parseArgsText(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Parses a `KEY=value` per line textarea into a Record. Invalid lines are dropped. */
function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    out[key] = line.slice(eq + 1);
  }
  return out;
}

/** Lowercase, ascii-only slug used to auto-derive the id from the name. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function HomePage({ onNavigate, onSelectServer }: Props) {
  const { data: servers = [] } = useServers();
  const addServer = useAddServer();

  const [form, setForm] = useState<FormState>({ ...TEMPLATE_FORM });
  // Tracks whether the user has manually edited the id field. When
  // false, name changes auto-update the id via `slugify`.
  const [idTouched, setIdTouched] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'name' && !idTouched) {
        next.id = slugify(value);
      }
      return next;
    });
  }

  // Field-level validation. The submit button is gated on this
  // object having no keys; individual errors are surfaced inline on
  // the corresponding `Field`.
  const errors = useMemo(() => {
    const e: {
      name?: string;
      id?: string;
      command?: string;
      args?: string;
      env?: string;
    } = {};
    if (form.name.trim().length === 0) e.name = 'name is required';
    const trimmedId = form.id.trim();
    // El id del form puede coincidir con el servidor recién añadido
    // (caso de éxito): en ese caso la colisión es "esperada" y
    // omitimos el error para no contaminar el estado post-éxito,
    // que está a punto de desmontarse al navegar al inspector.
    const justAddedId = addServer.data?.config.id;
    if (trimmedId.length === 0) {
      e.id = 'id is required';
    } else if (
      trimmedId !== justAddedId &&
      servers.some((s) => s.config.id === trimmedId)
    ) {
      e.id = `a server with id "${trimmedId}" already exists in your runner`;
    }
    if (form.command.trim().length === 0) e.command = 'command is required';
    if (parseArgsText(form.argsText).length === 0) {
      e.args = 'at least one argument is required';
    }
    const envLines = form.envText.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of envLines) {
      if (!/^[A-Z_][A-Z0-9_]*=.*$/.test(line)) {
        e.env = `invalid line: "${line}" — expected KEY=value (uppercase key)`;
        break;
      }
    }
    return e;
  }, [form, servers, addServer.data]);

  const hasErrors = Object.keys(errors).length > 0;
  const errorMessage = localError ?? addServer.error?.message ?? null;
  const canSubmit = !hasErrors && !addServer.isPending;

  const handleAdd = async () => {
    if (hasErrors) return;
    setLocalError(null);
    const config: McpServerConfig = {
      id: form.id.trim(),
      name: form.name.trim(),
      transport: 'stdio',
      command: form.command.trim(),
      args: parseArgsText(form.argsText),
      ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
      ...(form.envText.trim() ? { env: parseEnvText(form.envText) } : {}),
    };
    try {
      const server = await addServer.mutateAsync(config);
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
          Fill in the fields below to add a custom MCP server. The runner
          builds the configuration for you and persists it to{' '}
          <code>server/.data/servers.json</code>, where it becomes
          available in the inspector immediately.
        </p>

        <ErrorBanner
          error={errorMessage}
          onDismiss={handleDismissError}
          resetKey={errorMessage ?? ''}
        />

        <Field
          id="add-server-name"
          label="name"
          value={form.name}
          onChange={(e) => setField('name', e.target.value)}
          placeholder="filesystem"
          hint={!errors.name ? 'display name shown in the UI' : undefined}
          error={errors.name}
        />
        <Field
          id="add-server-id"
          label="id"
          mono
          value={form.id}
          onChange={(e) => {
            setIdTouched(true);
            setField('id', e.target.value);
          }}
          placeholder="filesystem"
          hint={!errors.id ? 'unique identifier used by the API. auto-derived from name until edited' : undefined}
          error={errors.id}
        />
        <Field
          id="add-server-command"
          label="command"
          value={form.command}
          onChange={(e) => setField('command', e.target.value)}
          placeholder="npx"
          hint={!errors.command ? 'executable to spawn (npx, node, python, uvx...)' : undefined}
          error={errors.command}
        />
        <Field
          as="textarea"
          id="add-server-args"
          label="arguments"
          value={form.argsText}
          onChange={(e) => setField('argsText', e.target.value)}
          placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
          hint={!errors.args ? 'one argument per line; blank lines are ignored' : undefined}
          error={errors.args}
        />

        <div className={styles.advanced}>
          <button
            type="button"
            className={styles.advancedToggle}
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            aria-controls="add-server-advanced"
          >
            <span className={styles.advancedArrow} aria-hidden="true">
              {showAdvanced ? '▾' : '▸'}
            </span>
            <span className={styles.advancedLabel}>Advanced</span>
            <span className={styles.advancedHint}>cwd · env</span>
          </button>
          {showAdvanced && (
            <div id="add-server-advanced" className={styles.advancedBody}>
              <Field
                id="add-server-cwd"
                label="working directory"
                value={form.cwd}
                onChange={(e) => setField('cwd', e.target.value)}
                placeholder="./fixtures-workspace"
                hint="optional. where the command runs from"
              />
              <Field
                as="textarea"
                id="add-server-env"
                label="environment variables"
                value={form.envText}
                onChange={(e) => setField('envText', e.target.value)}
                placeholder={'LICENSE=\nEMAIL='}
                hint="optional. one KEY=value per line; value may be empty"
                error={errors.env}
              />
            </div>
          )}
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
