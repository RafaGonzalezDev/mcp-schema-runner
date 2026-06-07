import { useEffect, useRef, useState } from 'react';
import styles from './ErrorBanner.module.css';

type Props = {
  /** Mensaje de error. Si es `null` o vacío, el banner no se renderiza. */
  error: string | null | undefined;
  /**
   * Milisegundos tras los cuales el banner se cierra automáticamente.
   * Si es `0` o `undefined`, el banner permanece hasta que el padre
   * lo desmonte cambiando `error` a `null`.
   */
  autoDismissMs?: number;
  /** Notifica al padre para que limpie su estado (recomendado). */
  onDismiss?: () => void;
  /** Permite resetear el temporizador cuando llega un error nuevo. */
  resetKey?: string | number;
};

/**
 * Banner de error con auto-dismiss opcional.
 *
 * Decisión de UX: los errores transitorios (conexión reusada, timeouts
 * de tool, etc.) deben limpiarse solos para no contaminar la pantalla
 * cuando el siguiente intento tiene éxito. El padre puede forzar el
 * cierre con `onDismiss` o pasando `error={null}`.
 */
export function ErrorBanner({ error, autoDismissMs = 6000, onDismiss, resetKey }: Props) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resetea visibilidad y temporizador ante un nuevo error.
  useEffect(() => {
    if (!error) {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (!autoDismissMs || autoDismissMs <= 0) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, autoDismissMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [error, autoDismissMs, resetKey, onDismiss]);

  if (!error || !visible) return null;

  return (
    <div className={styles.banner} role="alert">
      <div className={styles.message}>{error}</div>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => {
          if (timer.current) clearTimeout(timer.current);
          setVisible(false);
          onDismiss?.();
        }}
        aria-label="dismiss error"
      >
        dismiss
      </button>
    </div>
  );
}
