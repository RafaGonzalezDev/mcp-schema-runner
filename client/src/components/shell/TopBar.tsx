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
      <a
        href="#home"
        className={styles.brandLink}
        onClick={(e) => {
          e.preventDefault();
          onNavigate('home');
        }}
        aria-label="go to home"
      >
        <span className={styles.brandMark}>~</span>
        <span className={styles.brandName}>mcp-schema-runner</span>
        <span className={styles.brandSep}>/</span>
        <span className={styles.brandSuffix}>stdio</span>
        <StatusDot
          status={online ? 'connected' : 'error'}
          label={online ? 'api online' : 'api offline'}
        />
      </a>

      <nav className={styles.nav} aria-label="primary">
        {NAV.map((item, i) => (
          <span key={item.route} className={styles.navItem}>
            {i > 0 && (
              <span className={styles.sep} aria-hidden="true">·</span>
            )}
            <a
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
          </span>
        ))}
      </nav>
    </header>
  );
}
