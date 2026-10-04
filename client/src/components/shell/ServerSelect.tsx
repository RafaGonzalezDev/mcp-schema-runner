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
    // Allow deterministic dropdown preview without changing normal behavior.
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('open') === 'select';
  });
  const [focusIndex, setFocusIndex] = useState(0);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const search = useRef({ text: '', time: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const current = servers.find((s) => s.config.id === selectedId);
  const isActive = current?.status === 'connected';

  useEffect(() => {
    if (open) optionRefs.current[Math.min(focusIndex, servers.length - 1)]?.focus();
  }, [open, focusIndex, servers.length]);

  function openMenu(index = Math.max(0, servers.findIndex((server) => server.config.id === selectedId))) {
    setFocusIndex(index);
    setOpen(true);
  }

  // Close on outside interaction or Escape.
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
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            openMenu(event.key === 'End' || event.key === 'ArrowUp' ? servers.length - 1 : 0);
          }
        }}
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
        <ul id={listboxId} className={styles.menu} role="listbox" aria-label="servers"
          onKeyDown={(event) => {
            if (event.key === 'Tab') { triggerRef.current?.focus(); setOpen(false); return; }
            let next: number | undefined;
            if (event.key === 'ArrowDown') next = (focusIndex + 1) % servers.length;
            if (event.key === 'ArrowUp') next = (focusIndex - 1 + servers.length) % servers.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = servers.length - 1;
            if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
              const now = Date.now();
              search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase(), time: now };
              const match = servers.findIndex((server) => server.config.name.toLowerCase().startsWith(search.current.text));
              if (match >= 0) next = match;
            }
            if (next !== undefined) { event.preventDefault(); setFocusIndex(next); }
          }}>
          {servers.map((s, index) => {
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
                  ref={(element) => { optionRefs.current[index] = element; }}
                  tabIndex={focusIndex === index ? 0 : -1}
                  onFocus={() => setFocusIndex(index)}
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
                  <span className={styles.optionLine1}>
                    <StatusDot status={s.status} />
                    <span className={styles.optionName}>{s.config.name}</span>
                    <span className={styles.sep} aria-hidden="true">·</span>
                    <span className={metaClass}>{statusLabel[s.status]}</span>
                  </span>
                  <span className={styles.optionLine2}>
                    <span>{s.config.transport}</span>
                    <span className={styles.sep} aria-hidden="true">·</span>
                    <span>
                      {s.tools.length} {s.tools.length === 1 ? 'tool' : 'tools'}
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
