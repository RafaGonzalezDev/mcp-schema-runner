import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/primitives/Button';
import { Panel } from '../components/primitives/Panel';
import { EmptyState } from '../components/primitives/EmptyState';
import { ErrorBanner } from '../components/primitives/ErrorBanner';
import { ServerSelect } from '../components/shell/ServerSelect';
import { ToolList } from '../components/tools/ToolList';
import { SchemaViewer } from '../components/tools/SchemaViewer';
import { JsonEditor } from '../components/traces/JsonEditor';
import { ExecutionTrace } from '../components/traces/ExecutionTrace';
import {
  useServers,
  useConnect,
  useDisconnect,
  useCallTool,
  qk,
} from '../lib/hooks';
import { findServer, findTool, exampleFromSchema, parseJson } from '../lib/format';
import { useQueryClient } from '@tanstack/react-query';
import type { McpServerState, McpToolSummary, ToolExecutionTrace } from '../../../shared/types';
import styles from './InspectorPage.module.css';

type Props = {
  selectedServerId: string | null;
  onSelectServer: (id: string) => void;
};

export function InspectorPage({ selectedServerId, onSelectServer }: Props) {
  const { data: servers = [], isLoading: serversLoading, error: serversError } = useServers();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const callToolMutation = useCallTool();
  const qc = useQueryClient();

  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [argsText, setArgsText] = useState<string>('');

  const server = findServer(servers, selectedServerId);

  // Reset tool al cambiar servidor.
  useEffect(() => {
    setSelectedTool(null);
    setArgsText('');
  }, [selectedServerId]);

  const tool = useMemo(() => findTool(server?.tools, selectedTool), [server, selectedTool]);

  useEffect(() => {
    if (tool) setArgsText(exampleFromSchema(tool.inputSchema));
    else setArgsText('');
  }, [tool]);

  const parsedArgs = useMemo(() => parseJson(argsText), [argsText]);
  const argsValid = parsedArgs.ok;

  const lastTrace = useMemo<ToolExecutionTrace | undefined>(() => {
    if (!server || !selectedTool) return undefined;
    return qc.getQueryData<ToolExecutionTrace>(qk.lastTrace(server.config.id, selectedTool));
  }, [qc, server, selectedTool, callToolMutation.data]);

  const connecting = connect.isPending;

  const handleConnect = async () => {
    if (!server) return;
    try {
      await connect.mutateAsync(server.config.id);
    } catch (err) {
      console.error(err);
    }
  };
  const handleDisconnect = async () => {
    if (!server) return;
    await disconnect.mutateAsync(server.config.id);
  };
  const handleRun = async () => {
    if (!server || !selectedTool) return;
    if (!argsValid) return;
    try {
      await callToolMutation.mutateAsync({
        serverId: server.config.id,
        toolName: selectedTool,
        args: parsedArgs.ok ? parsedArgs.value : {},
      });
    } catch (err) {
      console.error(err);
    }
  };

  // No server selected: empty state con ServerSelect para que el
  // usuario pueda empezar.
  if (!server) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <ServerSelect
          servers={servers}
          selectedId={selectedServerId}
          onSelect={onSelectServer}
        />
        <EmptyState
          eyebrow="inspector"
          message={
            serversLoading
              ? 'loading servers...'
              : serversError?.message ?? 'select a server above to begin'
          }
          loading={serversLoading}
        />
      </div>
    );
  }

  const isConnected = server.status === 'connected';

  return (
    <div className={styles.page}>
      <PageHeader
        server={server}
        servers={servers}
        isConnected={isConnected}
        connecting={connecting}
        onSelectServer={onSelectServer}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      <div className={styles.main}>
        <ToolsPanel
          tools={server.tools}
          isConnected={isConnected}
          selectedTool={selectedTool}
          onSelectTool={setSelectedTool}
        />

        <div className={styles.panelsColumn}>
          <ErrorBanner
            error={connect.error?.message ?? null}
            onDismiss={connect.reset}
            resetKey={`connect:${server.config.id}:${connect.error?.message ?? ''}`}
          />

          <Panel
            title="Server config"
            subtitle={`${server.config.transport} · ${server.status}`}
            actions={
              <span className="numeric" style={{ fontSize: 'var(--font-size-xs)' }}>
                {isConnected ? `${server.tools.length} tools loaded` : 'no live tools'}
              </span>
            }
          >
            <ServerConfig server={server} />
          </Panel>

          <Panel
            title="Input schema"
            subtitle={
              tool
                ? `tool: ${tool.name}`
                : isConnected
                  ? 'pick a tool from the right'
                  : 'connect to load tools'
            }
          >
            <SchemaViewer tool={tool} />
          </Panel>

          <Panel
            title="Arguments"
            subtitle={tool ? 'edit JSON manually before running' : 'no tool selected'}
            actions={
              <Button
                variant="primary"
                compact
                onClick={handleRun}
                disabled={!isConnected || !tool || !argsValid || callToolMutation.isPending}
              >
                {callToolMutation.isPending ? 'running...' : 'run tool'}
              </Button>
            }
          >
            <JsonEditor
              schema={tool?.inputSchema}
              initial={argsText}
              onChange={setArgsText}
              disabled={!tool}
            />
          </Panel>

          <Panel
            title="Execution trace"
            subtitle={tool ? `${server.config.id} / ${tool.name}` : 'run a tool to populate'}
          >
            <ErrorBanner
              error={callToolMutation.error?.message ?? null}
              onDismiss={callToolMutation.reset}
              resetKey={`call:${server.config.id}:${tool?.name ?? ''}:${callToolMutation.error?.message ?? ''}`}
            />
            <ExecutionTrace trace={lastTrace} loading={callToolMutation.isPending} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function PageHeader({
  server,
  servers,
  isConnected,
  connecting,
  onSelectServer,
  onConnect,
  onDisconnect,
}: {
  server: McpServerState;
  servers: McpServerState[];
  isConnected: boolean;
  connecting: boolean;
  onSelectServer: (id: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <ServerSelect
          servers={servers}
          selectedId={server.config.id}
          onSelect={onSelectServer}
        />
      </div>
      <div className={styles.actions}>
        {isConnected ? (
          <Button variant="ghost" onClick={onDisconnect} disabled={connecting}>
            disconnect
          </Button>
        ) : (
          <Button variant="primary" onClick={onConnect} disabled={connecting}>
            {connecting ? 'connecting...' : 'connect'}
          </Button>
        )}
      </div>
    </header>
  );
}

function ToolsPanel({
  tools,
  isConnected,
  selectedTool,
  onSelectTool,
}: {
  tools: McpToolSummary[];
  isConnected: boolean;
  selectedTool: string | null;
  onSelectTool: (name: string) => void;
}) {
  return (
    <aside className={styles.toolsPanel} aria-label="tools">
      <div className={styles.toolsHead}>
        <span className={styles.toolsTitle}>tools</span>
        <span className={styles.toolsCount}>{tools.length}</span>
      </div>
      <div className={styles.toolsBody}>
        {isConnected ? (
          tools.length > 0 ? (
            <ToolList tools={tools} selectedName={selectedTool} onSelect={onSelectTool} />
          ) : (
            <div className={styles.toolsEmpty}>server returned no tools</div>
          )
        ) : (
          <div className={styles.toolsEmpty}>
            connect the server
            <br />
            to list tools
          </div>
        )}
      </div>
    </aside>
  );
}

function ServerConfig({ server }: { server: McpServerState }) {
  const envEntries = Object.entries(server.config.env ?? {});
  return (
    <div className={styles.configBox}>
      <div className={styles.configRow}>
        <span className={styles.configKey}>command</span>
        <span className={styles.configVal}>{server.config.command}</span>
      </div>
      <div className={styles.configRow}>
        <span className={styles.configKey}>args</span>
        <span className={styles.configVal}>
          {server.config.args.length > 0 ? server.config.args.join(' ') : '—'}
        </span>
      </div>
      {server.config.cwd && (
        <div className={styles.configRow}>
          <span className={styles.configKey}>cwd</span>
          <span className={styles.configVal}>{server.config.cwd}</span>
        </div>
      )}
      <div className={styles.configRow}>
        <span className={styles.configKey}>env</span>
        <span className={styles.configVal}>
          {envEntries.length > 0
            ? envEntries.map(([k, v]) => `${k}=${v}`).join(' · ')
            : '—'}
        </span>
      </div>
      {typeof server.pid === 'number' && (
        <div className={styles.configRow}>
          <span className={styles.configKey}>pid</span>
          <span className={styles.configVal}>{server.pid}</span>
        </div>
      )}
      {server.config.notes && (
        <div className={styles.configRow}>
          <span className={styles.configKey}>notes</span>
          <span className={styles.configVal}>{server.config.notes}</span>
        </div>
      )}
    </div>
  );
}
