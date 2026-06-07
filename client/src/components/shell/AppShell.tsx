import type { ReactNode } from 'react';
import { TopBar } from './TopBar';
import type { Route } from '../../lib/router';
import styles from './AppShell.module.css';

type Props = {
  online: boolean;
  currentRoute: Route;
  onNavigate: (route: Route) => void;
  children: ReactNode;
};

/**
 * AppShell: topbar sticky + slot principal.
 *
 * El layout específico de cada página (grid en Inspector, columna
 * centrada en Home) es responsabilidad de la página, no del shell.
 */
export function AppShell({ online, currentRoute, onNavigate, children }: Props) {
  return (
    <div className={styles.app}>
      <TopBar online={online} currentRoute={currentRoute} onNavigate={onNavigate} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
