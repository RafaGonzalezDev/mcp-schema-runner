import { StatusDot } from '../primitives/StatusDot';
import type { Route } from '../../lib/router';
import styles from './TopBar.module.css';

type NavItem = { route: Route; label: string };

const NAV: readonly NavItem[] = [
  { route: 'home', label: 'home' },
  { route: 'inspector', label: 'inspector' },
];

type Props = {
  online: boolean;
  currentRoute: Route;
  onNavigate: (route: Route) => void;
};

export function TopBar({ online, currentRoute, onNavigate }: Props) {
  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>~</span>
        <span className={styles.brandName}>mcp-schema-runner</span>
        <span className={styles.brandSep}>/</span>
        <span className={styles.brandSuffix}>stdio</span>
        <StatusDot status={online ? 'connected' : 'error'} label={online ? 'api online' : 'api offline'} />
      </div>

      <nav className={styles.nav} aria-label="primary">
        {NAV.map((item) => (
          <a
            key={item.route}
            href={`#${item.route}`}
            className={[
              styles.navLink,
              currentRoute === item.route ? styles.active : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(item.route);
            }}
            aria-current={currentRoute === item.route ? 'page' : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
