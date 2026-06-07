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
          {...(props as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      ) : (
        <input
          id={id}
          className={[
            styles.input,
            (props as InputProps).mono ? styles.inputMono : '',
          ]
            .filter(Boolean)
            .join(' ')}
          {...(props as InputHTMLAttributes<HTMLInputElement>)}
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
