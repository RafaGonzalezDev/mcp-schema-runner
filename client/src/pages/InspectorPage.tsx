import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/primitives/Button';
import { Panel } from '../components/primitives/Panel';
import { EmptyState } from '../components/primitives/EmptyState';
import { ErrorBanner } from '../components/primitives/ErrorBanner';
import { Field } from '../components/primitives/Field';
import { ServerSelect } from '../components/shell/ServerSelect';
import { MigrationNotice } from '../components/shell/MigrationNotice';
import { ToolList } from '../components/tools/ToolList';
import { SchemaViewer } from '../components/tools/SchemaViewer';
import { JsonEditor } from '../components/traces/JsonEditor';
import { ExecutionTrace } from '../components/traces/ExecutionTrace';
import { useServers, useConnect, useDisconnect, useCallTool, useLastTrace, useSetServerEnvironment } from '../lib/hooks';
import { findServer, findTool, exampleFromSchema, parseJson } from '../lib/format';
import type { McpServerState, McpToolSummary } from '../../../shared/types';
import styles from './InspectorPage.module.css';

type Props = { selectedServerId: string | null; onSelectServer: (id: string) => void };
const draftKey = (serverId: string, toolName: string) => JSON.stringify([serverId, toolName]);

export function InspectorPage({ selectedServerId, onSelectServer }: Props) {
  const { data: servers = [], isLoading, error: serversError, migrationPending } = useServers();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const call = useCallTool();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const server = findServer(servers, selectedServerId);
  const selectedTool = selectedServerId ? selections[selectedServerId] ?? null : null;
  const tool = findTool(server?.tools, selectedTool);
  const key = selectedServerId && selectedTool ? draftKey(selectedServerId, selectedTool) : null;
  const argsText = key ? drafts[key] ?? '' : '';
  const parsedArgs = useMemo(() => parseJson(argsText), [argsText]);
  const argsValid = parsedArgs.ok && typeof parsedArgs.value === 'object' && parsedArgs.value !== null && !Array.isArray(parsedArgs.value);
  const { data: lastTrace } = useLastTrace(selectedServerId, selectedTool);
  const connecting = (connect.isPending && connect.variables === selectedServerId) || server?.status === 'connecting';
  const disconnecting = disconnect.isPending && disconnect.variables === selectedServerId;
  const calling = call.isPending && call.variables?.serverId === selectedServerId && call.variables?.toolName === selectedTool;
  const operationsBlocked = migrationPending || !!serversError;

  // Select a usable tool without replacing any existing per-tool draft.
  useEffect(() => {
    if (!server || server.status !== 'connected' || server.tools.some((item) => item.name === selectedTool)) return;
    const first = server.tools[0];
    if (!first) return;
    const nextKey = draftKey(server.config.id, first.name);
    setSelections((previous) => ({ ...previous, [server.config.id]: first.name }));
    setDrafts((previous) => Object.hasOwn(previous, nextKey) ? previous : {
      ...previous, [nextKey]: exampleFromSchema(first.inputSchema),
    });
  }, [server, selectedTool]);

  function selectTool(name: string) {
    if (!server) return;
    const nextKey = draftKey(server.config.id, name);
    setSelections((previous) => ({ ...previous, [server.config.id]: name }));
    setDrafts((previous) => Object.hasOwn(previous, nextKey) ? previous : {
      ...previous, [nextKey]: exampleFromSchema(findTool(server.tools, name)?.inputSchema),
    });
  }

  if (!server) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <MigrationNotice pending={migrationPending} />
      <ServerSelect servers={servers} selectedId={selectedServerId} onSelect={onSelectServer} />
      <EmptyState eyebrow="inspector" message={isLoading ? 'loading servers...' : serversError?.message ?? 'select a server above to begin'} loading={isLoading} />
    </div>
  );

  const isConnected = server.status === 'connected';
  const missingEnvironment = (server.missingEnvKeys?.length ?? 0) > 0;
  return (
    <div className={styles.page}>
      <MigrationNotice pending={migrationPending} />
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.serverIdentity}>
            <span className={styles.eyebrow}>MCP inspector</span>
            <ServerSelect servers={servers} selectedId={server.config.id} onSelect={onSelectServer} />
          </div>
          <span className={styles.connectionState} data-connected={isConnected}>{server.status}</span>
        </div>
        <div className={styles.actions}>
          {isConnected || connecting ? (
            <Button variant="ghost" disabled={disconnecting || migrationPending} onClick={() => disconnect.mutate(server.config.id)}>
              {disconnecting ? 'disconnecting...' : connecting ? 'cancel connection' : 'disconnect'}
            </Button>
          ) : (
            <Button variant="primary" disabled={operationsBlocked || disconnecting || missingEnvironment} onClick={() => connect.mutate(server.config.id)}>
              connect
            </Button>
          )}
        </div>
      </header>
      <details className={styles.serverDetails}>
        <summary>Server configuration <span className={styles.detailsHint}>command, environment names and references</span></summary>
        <ServerConfig server={server} />
      </details>
      <div className={styles.main}>
        <ToolsPanel tools={server.tools} isConnected={isConnected} selectedTool={selectedTool} onSelectTool={selectTool} />
        <div className={styles.panelsColumn}>
          <ErrorBanner error={serversError?.message} />
          <ErrorBanner error={connect.variables === server.config.id ? connect.error?.message : null} onDismiss={connect.reset} />
          <ErrorBanner error={disconnect.variables === server.config.id ? disconnect.error?.message : null} onDismiss={disconnect.reset} />
          <ErrorBanner error={server.status === 'error' ? server.error : null} />
          {(server.config.sessionEnvKeys?.length ?? 0) > 0 && (
            <Panel title="Session environment" subtitle="values are held only in backend memory">
              <SessionEnvironment key={server.config.id} server={server} disabled={operationsBlocked || isConnected || connecting || disconnecting} />
            </Panel>
          )}
          {missingEnvironment && <p role="status">Missing environment values: {server.missingEnvKeys?.join(', ')}. Enter session values below or check the backend references before connecting.</p>}
          <header className={styles.workspaceHead}>
            <div>
              <p className={styles.eyebrow}>{tool ? 'Selected tool' : 'Tool workspace'}</p>
              <h1 className={styles.toolName}>{tool?.name ?? (isConnected ? 'Choose a tool' : 'Connect to begin')}</h1>
              <p className={styles.toolDescription}>{tool?.description ?? (isConnected ? 'Select a tool from the list to inspect its inputs and run it.' : 'Connect this server to load its tools, schemas and example arguments.')}</p>
            </div>
            {tool && <span className={styles.workspaceBadge}>stdio tool</span>}
          </header>
          <div className={styles.toolPanels}>
          <Panel title="Input schema" subtitle="01 · understand the inputs">
            <SchemaViewer tool={tool} />
          </Panel>
          <Panel title="Arguments" subtitle={tool ? '02 · edit and run' : 'no tool selected'} actions={
            <Button variant="primary" disabled={operationsBlocked || !isConnected || !tool || !argsValid || calling || disconnecting}
              onClick={() => {
                if (selectedTool && argsValid && parsedArgs.ok) call.mutate({ serverId: server.config.id, toolName: selectedTool, args: parsedArgs.value });
              }}>{calling ? 'calling...' : 'call tool'}</Button>
          }>
            <JsonEditor key={key} schema={tool?.inputSchema} value={argsText}
              onChange={(text) => { if (key) setDrafts((previous) => ({ ...previous, [key]: text })); }} disabled={!tool} />
          </Panel>
          </div>
          <Panel title="Execution trace" subtitle={tool ? `03 · result · ${server.config.id} / ${tool.name}` : 'run a tool to populate'}>
            <ExecutionTrace trace={lastTrace} loading={calling}
              error={call.variables?.serverId === server.config.id && call.variables?.toolName === selectedTool ? call.error?.message : null} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function SessionEnvironment({ server, disabled }: { server: McpServerState; disabled: boolean }) {
  const mutation = useSetServerEnvironment();
  const keys = server.config.sessionEnvKeys ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [saved]);
  return (
    <form className={styles.environmentForm} onSubmit={(event) => {
      event.preventDefault();
      if (disabled || mutation.isPending) return;
      mutation.mutate({ id: server.config.id, env: Object.fromEntries(keys.map((key) => [key, values[key] ?? ''])) }, {
        onSuccess: () => { setValues({}); setSaved(true); },
      });
    }}>
      <p>Enter all listed values to replace this server's session environment. Disconnect before changing them. Values are cleared from these inputs after saving.</p>
      {keys.map((key) => <Field key={key} label={`Session value: ${key}`} type="password" autoComplete="new-password"
        value={values[key] ?? ''} disabled={disabled || mutation.isPending}
        onChange={(event) => { setSaved(false); setValues((previous) => ({ ...previous, [key]: event.target.value })); }} />)}
      <ErrorBanner error={mutation.error?.message} onDismiss={mutation.reset} />
      <Button type="submit" variant="primary" disabled={disabled || mutation.isPending}>{mutation.isPending ? 'saving...' : 'set session environment'}</Button>
      <p role="status">{saved ? 'Session environment updated. No values were saved to disk.' : ''}</p>
    </form>
  );
}

function ToolsPanel({ tools, isConnected, selectedTool, onSelectTool }: {
  tools: McpToolSummary[]; isConnected: boolean; selectedTool: string | null; onSelectTool: (name: string) => void;
}) {
  return (
    <aside className={styles.toolsPanel} aria-label="tools">
      <div className={styles.toolsHead}>
        <div><h2 className={styles.toolsTitle}>Tools</h2><p className={styles.toolsHint}>Select a tool to work with</p></div>
        <span className={styles.toolsCount}>{tools.length}</span>
      </div>
      <div className={styles.toolsBody}>
        {isConnected ? tools.length > 0 ? <ToolList tools={tools} selectedName={selectedTool} onSelect={onSelectTool} /> : <div className={styles.toolsEmpty}>server returned no tools</div>
          : <div className={styles.toolsEmpty}>connect the server<br />to list tools</div>}
      </div>
    </aside>
  );
}

function ServerConfig({ server }: { server: McpServerState }) {
  const rows: Array<[string, string]> = [
    ['command', server.config.command], ['args', server.config.args.join(' ') || '—'],
    ['session variable names', server.config.sessionEnvKeys?.join(', ') || '—'],
    ['environment references', Object.entries(server.config.envRefs ?? {}).map(([key, reference]) => `${key} → ${reference}`).join(' · ') || '—'],
  ];
  if (server.config.cwd) rows.push(['cwd', server.config.cwd]);
  if (typeof server.pid === 'number') rows.push(['pid', String(server.pid)]);
  if (server.config.notes) rows.push(['notes', server.config.notes]);
  return <dl className={styles.configBox}>{rows.map(([label, value]) => (
    <div key={label} className={styles.configRow}><dt className={styles.configKey}>{label}</dt><dd className={styles.configVal}>{value}</dd></div>
  ))}</dl>;
}
