import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'ghost' | 'danger';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  compact?: boolean;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  compact = false,
  className,
  children,
  ...rest
}: Props) {
  const classes = [
    styles.button,
    styles[variant],
    compact ? styles.compact : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" {...rest} className={classes}>
      {children}
    </button>
  );
}
