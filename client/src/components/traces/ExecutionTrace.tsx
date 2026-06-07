import { formatDuration, formatJson } from '../../lib/format';
import type { ToolExecutionTrace } from '../../../../shared/types';
import styles from './ExecutionTrace.module.css';

type Props = {
  trace: ToolExecutionTrace | undefined;
  loading?: boolean;
  error?: string | null;
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

export function ExecutionTrace({ trace, loading, error }: Props) {
  if (loading) {
    return (
      <div className={styles.empty}>
        <div className="spinner" aria-hidden="true" style={{ margin: '0 auto var(--space-3)' }} />
        executing tool...
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.section}>
        <div className={[styles.label, styles.error].join(' ')}>request failed</div>
        <pre className={[styles.block, styles.error].join(' ')}>{error}</pre>
      </div>
    );
  }
  if (!trace) {
    return <div className={styles.empty}>no execution yet — run a tool to see its trace</div>;
  }

  return (
    <div className={styles.trace}>
      <div className={styles.meta}>
        <div className={styles.metaItem}>
          status
          <span
            className={[
              styles.metaValue,
              trace.status === 'success' ? styles.accent : styles.danger,
            ].join(' ')}
          >
            {trace.status}
          </span>
        </div>
        <div className={styles.metaItem}>
          duration
          <span className={styles.metaValue}>{formatDuration(trace.durationMs)}</span>
        </div>
        <div className={styles.metaItem}>
          at
          <span className={styles.metaValue}>{formatTimestamp(trace.timestamp)}</span>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.label}>request</div>
        <pre className={styles.block}>{formatJson(trace.request, '/* no request body */')}</pre>
      </div>

      {trace.status === 'success' ? (
        <div className={styles.section}>
          <div className={[styles.label, styles.success].join(' ')}>response</div>
          <pre className={styles.block}>{formatJson(trace.response, '/* no response body */')}</pre>
        </div>
      ) : (
        <div className={styles.section}>
          <div className={[styles.label, styles.error].join(' ')}>error</div>
          <pre className={[styles.block, styles.error].join(' ')}>
            {trace.error?.message ?? 'unknown error'}
            {trace.error?.stack ? `\n\n${trace.error.stack}` : ''}
          </pre>
        </div>
      )}
    </div>
  );
}
