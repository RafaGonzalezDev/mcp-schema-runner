import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import styles from './Field.module.css';

type CommonProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
};

type InputProps = CommonProps &
  InputHTMLAttributes<HTMLInputElement> & {
    as?: 'input';
    mono?: boolean;
  };

type TextareaProps = CommonProps &
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    as: 'textarea';
  };

export function Field(props: InputProps | TextareaProps) {
  const { label, hint, error, id } = props;
  const errorId = id ? `${id}-error` : undefined;
  // Extraemos props que son solo del wrapper y no deben propagarse
  // al elemento nativo (evita warnings de React por atributos
  // booleanos desconocidos en el DOM).
  const { mono, as: _as, ...rest } = props as InputProps;
  void _as;
  return (
    <div className={styles.field}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}
      {props.as === 'textarea' ? (
        <textarea
          id={id}
          className={styles.textarea}
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      ) : (
        <input
          id={id}
          className={[styles.input, mono ? styles.inputMono : '']
            .filter(Boolean)
            .join(' ')}
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      )}
      {hint && !error && <div className={styles.hint}>{hint}</div>}
      {error && (
        <div className={styles.error} id={errorId} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
