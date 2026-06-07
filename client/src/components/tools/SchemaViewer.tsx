import { formatJson } from '../../lib/format';
import type { McpToolSummary } from '../../../../shared/types';
import styles from './SchemaViewer.module.css';

type Props = {
  tool: McpToolSummary | undefined;
};

type SchemaSummary = {
  type?: string;
  required: string[];
  propertyNames: string[];
};

function summarize(schema: unknown): SchemaSummary {
  if (!schema || typeof schema !== 'object') return { required: [], propertyNames: [] };
  const s = schema as Record<string, unknown>;
  const required = Array.isArray(s['required'])
    ? (s['required'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const propertyNames =
    s['properties'] && typeof s['properties'] === 'object'
      ? Object.keys(s['properties'] as Record<string, unknown>)
      : [];
  const type = typeof s['type'] === 'string' ? (s['type'] as string) : undefined;
  return { type, required, propertyNames };
}

export function SchemaViewer({ tool }: Props) {
  if (!tool) {
    return <div className={styles.empty}>select a tool to inspect its input schema</div>;
  }
  const summary = summarize(tool.inputSchema);
  return (
    <div>
      {(summary.type || summary.required.length > 0 || summary.propertyNames.length > 0) && (
        <div className={styles.meta}>
          {summary.type && <span className={[styles.metaTag, styles.accent].join(' ')}>type: {summary.type}</span>}
          {summary.propertyNames.length > 0 && (
            <span className={styles.metaTag}>
              {summary.propertyNames.length} {summary.propertyNames.length === 1 ? 'property' : 'properties'}
            </span>
          )}
          {summary.required.length > 0 && (
            <span className={[styles.metaTag, styles.accent].join(' ')}>
              required: {summary.required.join(', ')}
            </span>
          )}
        </div>
      )}
      <pre className={styles.viewer} aria-label="input schema">
        {formatJson(tool.inputSchema, '/* schema unavailable */') || '/* empty schema */'}
      </pre>
    </div>
  );
}
