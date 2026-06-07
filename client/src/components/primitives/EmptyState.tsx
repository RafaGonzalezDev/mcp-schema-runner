import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

type Props = {
  /** Eyebrow mono uppercase mostrado sobre el mensaje. */
  eyebrow?: ReactNode;
  message: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
};

export function EmptyState({ eyebrow, message, actions, loading = false }: Props) {
  return (
    <div className={styles.state} role="status">
      {loading && <div className="spinner" aria-hidden="true" />}
      {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
      <div className={styles.message}>{message}</div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
