import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/primitives/Button';
import { ErrorBanner } from '../components/primitives/ErrorBanner';
import { Field } from '../components/primitives/Field';
import { useAddServer, useServers } from '../lib/hooks';
import type { AddServerConfig } from '../../../shared/types';
import { parseEnvironment } from '../lib/environment';
import { MigrationNotice } from '../components/shell/MigrationNotice';
import type { Route } from '../lib/router';
import { builtinFixtures } from '../../../shared/fixtures';
import styles from './HomePage.module.css';

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Configure a stdio MCP server',
    body: (
      <>
        A server is described by a JSON object with <code>command</code>,{' '}
        <code>args</code> and optionally session <code>env</code>, saved{' '}
        <code>envRefs</code> and <code>cwd</code>.
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
        Click any tool in the tool list to see its <code>inputSchema</code>.
        The runner pre-fills example arguments derived from the schema so you
        can iterate fast.
      </>
    ),
  },
  {
    title: 'Run and read the trace',
    body: (
      <>
        Edit the JSON arguments and press <code>call tool</code>. The execution
        trace shows the SDK <code>request</code> arguments, the <code>response</code> or{' '}
        <code>error</code> returned, the duration and the timestamp. It is not a
        JSON-RPC wire capture.
      </>
    ),
  },
];

/**
 * Starter values for the form. Copies the bundled offline demo under a
 * distinct id, so the untouched form can be submitted and connected with no
 * download. Built-in ids stay reserved and can never be reused here.
 */
const starter = builtinFixtures.find((fixture) => fixture.id === 'demo');
const TEMPLATE_FORM = {
  name: 'my-server',
  id: 'my-server',
  command: starter?.command ?? 'node',
  argsText: starter?.args.join('\n') ?? '',
  cwd: '',
  envText: '',
  envRefsText: '',
} as const;

type FormState = {
  name: string;
  id: string;
  command: string;
  argsText: string;
  cwd: string;
  envText: string;
  envRefsText: string;
};

type Props = {
  onNavigate: (route: Route) => void;
  onSelectServer: (id: string) => void;
};

/** Parses a one-argument-per-line textarea into a string[]. Blank lines are dropped. */
function parseArgsText(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
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
  const { data: servers = [], migrationPending, error: serversError, isLoading: serversLoading } = useServers();
  const addServer = useAddServer();

  const [form, setForm] = useState<FormState>({ ...TEMPLATE_FORM });
  // Tracks whether the user has manually edited the id field. When
  // false, name changes auto-update the id via `slugify`.
  const [idTouched, setIdTouched] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitted, setSubmitted] = useState(0);
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const formRef = useRef<HTMLFormElement>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'name' && !idTouched) {
        next.id = slugify(value);
      }
      return next;
    });
  }

  const environment = useMemo(() => parseEnvironment(form.envText), [form.envText]);
  const references = useMemo(() => parseEnvironment(form.envRefsText, true), [form.envRefsText]);
  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) e.name = 'name is required';
    const takenId = servers.find((s) => s.config.id === form.id.trim());
    if (!form.id.trim()) e.id = 'id is required';
    else if (takenId && takenId.config.id !== addServer.data?.config.id) {
      e.id = takenId.builtin
        ? 'this id is reserved by a built-in demo; choose a unique id'
        : 'this id is already configured; choose a unique id';
    }
    if (!form.command.trim()) e.command = 'command is required';
    if (!environment.ok) e.envText = environment.error;
    if (!references.ok) e.envRefsText = references.error;
    if (environment.ok && references.ok && Object.keys(environment.values).some((key) => Object.hasOwn(references.values, key))) {
      e.envRefsText = 'Use either a session value or a reference for each variable, not both.';
    }
    return e;
  }, [form, servers, addServer.data, environment, references]);

  useEffect(() => {
    if (submitted) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [submitted]);

  const visibleError = (key: keyof FormState) => submitted || touched[key] ? errors[key] : undefined;
  const markTouched = (key: keyof FormState) => setTouched((previous) => ({ ...previous, [key]: true }));
  const errorMessage = addServer.error?.message ?? serversError?.message ?? null;
  const canSubmit = !addServer.isPending && !migrationPending && !serversLoading && !serversError;

  const handleAdd = () => {
    setSubmitted((count) => count + 1);
    if (errors.envText || errors.envRefsText) setShowAdvanced(true);
    if (Object.keys(errors).length || !canSubmit || !environment.ok || !references.ok) return;
    const config: AddServerConfig = {
      id: form.id.trim(), name: form.name.trim(), transport: 'stdio', command: form.command.trim(),
      args: parseArgsText(form.argsText),
      ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
      ...(form.envText.trim() ? { env: environment.values } : {}),
      ...(form.envRefsText.trim() ? { envRefs: references.values } : {}),
    };
    addServer.mutate(config, { onSuccess: (server) => {
      setForm((previous) => ({ ...previous, envText: '' }));
      onSelectServer(server.config.id);
      onNavigate('inspector');
    } });
  };

  const handleDismissError = () => addServer.reset();

  const success = addServer.data;

  return (
    <div className={styles.home}>
      <header className={styles.hero}>
        <div className={styles.eyebrow}>mcp-schema-runner · v0.1</div>
        <h1 className={styles.title}>Debug stdio MCP servers locally.</h1>
        <p className={styles.lead}>
          Inspect tool schemas, execute manual tool calls and inspect raw
          argument / result / error traces — everything you need to validate a
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
          saves the command, variable names and backend references locally.
          Literal environment values are held in backend memory for this session only.
        </p>

        <MigrationNotice pending={migrationPending} />
        <p className={styles.stepText}>Name, id and command are required. Arguments may be empty.</p>
        <form className={styles.addForm} ref={formRef} noValidate onSubmit={(event) => { event.preventDefault(); handleAdd(); }}>
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
          placeholder="my-server"
          hint={!errors.name ? 'display name shown in the UI' : undefined}
          error={visibleError('name')}
          onBlur={() => markTouched('name')}
          required aria-required="true"
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
          placeholder="my-server"
          hint={!errors.id ? 'unique identifier used by the API. auto-derived from name until edited. built-in demo ids are reserved' : undefined}
          error={visibleError('id')}
          onBlur={() => markTouched('id')}
          required aria-required="true"
        />
        <Field
          id="add-server-command"
          label="command"
          value={form.command}
          onChange={(e) => setField('command', e.target.value)}
          placeholder="npx"
          hint={!errors.command ? 'executable to spawn (npx, node, python, uvx...)' : undefined}
          error={visibleError('command')}
          onBlur={() => markTouched('command')}
          required aria-required="true"
        />
        <Field
          as="textarea"
          id="add-server-args"
          label="arguments"
          value={form.argsText}
          onChange={(e) => setField('argsText', e.target.value)}
          placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
          hint="one argument per line; empty arguments are allowed. Relative paths use the repository root unless a working directory is set."
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
                hint="optional. where the command runs from; defaults to the repository root"
              />
              <Field
                as="textarea"
                id="add-server-env"
                label="environment variables"
                value={form.envText}
                onChange={(e) => setField('envText', e.target.value)}
                placeholder={'LICENSE=\nEMAIL='}
                hint="session-only. One KEY=value per line; values are never saved or shown in server config."
                error={visibleError('envText')}
                onBlur={() => markTouched('envText')}
                autoComplete="off"
                spellCheck={false}
              />
              <Field
                as="textarea"
                id="add-server-env-refs"
                label="environment references"
                value={form.envRefsText}
                onChange={(event) => setField('envRefsText', event.target.value)}
                onBlur={() => markTouched('envRefsText')}
                placeholder="API_KEY=MY_BACKEND_API_KEY"
                hint="saved names only. KEY=BACKEND_VARIABLE reads the value from the backend environment."
                error={visibleError('envRefsText')}
              />
            </div>
          )}
        </div>

        <div className={styles.addActions}>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {addServer.isPending ? 'adding...' : 'add server'}
          </Button>
        </div>
        </form>

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
