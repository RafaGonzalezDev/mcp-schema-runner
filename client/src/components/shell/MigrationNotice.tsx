import { useEffect, useId, useRef, useState } from 'react';
import { useMigrateConfig } from '../../lib/hooks';
import { Button } from '../primitives/Button';
import { ErrorBanner } from '../primitives/ErrorBanner';
import styles from './MigrationNotice.module.css';

export function MigrationNotice({ pending }: { pending: boolean }) {
  const migration = useMigrateConfig();
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) return;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (triggerRef.current) triggerRef.current.focus();
      else document.getElementById('main-content')?.focus();
    };
  }, [confirming]);

  useEffect(() => {
    if (confirming && migration.isPending) dialogRef.current?.focus();
  }, [confirming, migration.isPending]);

  if (!pending) return null;
  return (
    <section className={styles.notice} aria-label="Configuration migration">
      <p role="status">Your saved configuration needs a security migration before changing or running servers.</p>
      <button ref={triggerRef} type="button" onClick={() => setConfirming(true)}>review migration</button>
      {confirming && (
        <div className={styles.overlay}>
          <div ref={dialogRef} className={styles.dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={titleId}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !migration.isPending) setConfirming(false);
              if (event.key === 'Tab') {
                const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
                if (!first) event.preventDefault();
              }
            }}>
            <h2 id={titleId}>Remove saved environment values?</h2>
            <p>This rewrites the configuration without literal environment values. Existing values stay in backend memory for this session only; after restarting, enter them again. Variable names and references remain saved.</p>
            <p>The previous plaintext values will no longer be stored in the configuration file. This file change cannot be undone from the app.</p>
            <ErrorBanner error={migration.error?.message} onDismiss={migration.reset} />
            <div className={styles.actions}>
              <Button variant="ghost" disabled={migration.isPending} onClick={() => setConfirming(false)}>cancel</Button>
              <Button variant="primary" disabled={migration.isPending} onClick={() => migration.mutate(undefined, { onSuccess: () => setConfirming(false) })}>
                {migration.isPending ? 'migrating...' : 'confirm migration'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
