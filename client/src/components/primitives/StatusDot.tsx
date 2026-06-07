import type { McpConnectionStatus } from '../../../../shared/types';
import styles from './StatusDot.module.css';

type Props = {
  status: McpConnectionStatus;
  /** Texto accesible opcional. Si no se pasa, se usa el status. */
  label?: string;
};

const labels: Record<McpConnectionStatus, string> = {
  connected: 'connected',
  connecting: 'connecting',
  disconnected: 'disconnected',
  error: 'error',
};

export function StatusDot({ status, label }: Props) {
  return (
    <span
      className={[styles.dot, styles[status]].join(' ')}
      role="status"
      aria-label={label ?? labels[status]}
    />
  );
}
