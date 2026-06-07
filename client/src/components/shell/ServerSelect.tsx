import { useEffect, useId, useRef, useState } from 'react';
import { StatusDot } from '../primitives/StatusDot';
import type { McpServerState } from '../../../../shared/types';
import styles from './ServerSelect.module.css';

type Props = {
  servers: McpServerState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const statusLabel: Record<McpServerState['status'], string> = {
  connected: 'connected',
  connecting: 'connecting',
  disconnected: 'disconnected',
  error: 'error',
};

function ChevronIcon() {
  return (
    <svg
      className={styles.chevron}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ServerSelect({ servers, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(() => {
    // Soporte para `?open=select` — usado por capturas headless para
    // verificar el alineamiento del dropdown. No afecta al uso normal.
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('open') === 'select';
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const current = servers.find((s) => s.config.id === selectedId);
  const isActive = current?.status === 'connected';

  // Cierra al hacer click fuera o al pulsar Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (servers.length === 0) {
    return (
      <div className={styles.root}>
        <button type="button" className={styles.trigger} disabled>
          <StatusDot status="disconnected" />
          <span className={styles.name}>no servers</span>
          <span className={styles.meta}>—</span>
          <ChevronIcon />
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={[styles.trigger, isActive ? styles.active : ''].filter(Boolean).join(' ')}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
      >
        <StatusDot status={current?.status ?? 'disconnected'} />
        <span className={styles.name}>{current?.config.name ?? 'select a server'}</span>
        <span className={styles.meta}>
          {current ? `${current.tools.length} ${current.tools.length === 1 ? 'tool' : 'tools'}` : '—'}
        </span>
        <ChevronIcon />
      </button>

      {open && (
        <ul id={listboxId} className={styles.menu} role="listbox" aria-label="servers">
          {servers.map((s) => {
            const isSelected = s.config.id === selectedId;
            const metaClass =
              s.status === 'connected'
                ? styles.accent
                : s.status === 'error'
                  ? styles.danger
                  : '';
            return (
              <li key={s.config.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={[styles.option, isSelected ? styles.selected : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    onSelect(s.config.id);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <StatusDot status={s.status} />
                  <span className={styles.optionBody}>
                    <span className={styles.optionName}>{s.config.name}</span>
                    <span className={styles.optionMeta}>
                      <span className={metaClass}>{statusLabel[s.status]}</span>
                      <span className={styles.sep} aria-hidden="true">·</span>
                      <span>{s.config.transport}</span>
                      <span className={styles.sep} aria-hidden="true">·</span>
                      <span>
                        {s.tools.length} {s.tools.length === 1 ? 'tool' : 'tools'}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
