import type { ReactNode } from 'react';
import styles from './Panel.module.css';

type Props = {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  dense?: boolean;
  children: ReactNode;
  className?: string;
};

export function Panel({
  title,
  subtitle,
  actions,
  footer,
  flush = false,
  dense = false,
  children,
  className,
}: Props) {
  const hasHead = title !== undefined || subtitle !== undefined || actions !== undefined;
  const bodyClasses = [
    styles.body,
    flush ? styles.bodyFlush : '',
    dense ? styles.bodyDense : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section className={[styles.panel, className ?? ''].filter(Boolean).join(' ')}>
      {hasHead && (
        <header className={styles.head}>
          <div className={styles.headBody}>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
            {title && <div className={styles.title}>{title}</div>}
          </div>
          {actions && <div className={styles.headActions}>{actions}</div>}
        </header>
      )}
      <div className={bodyClasses}>{children}</div>
      {footer && <footer className={styles.foot}>{footer}</footer>}
    </section>
  );
}
