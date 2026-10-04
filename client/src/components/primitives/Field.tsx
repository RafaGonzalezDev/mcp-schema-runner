import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import styles from './Field.module.css';

type CommonProps = { label?: ReactNode; hint?: ReactNode; error?: ReactNode; id?: string };
type InputProps = CommonProps & InputHTMLAttributes<HTMLInputElement> & { as?: 'input'; mono?: boolean };
type TextareaProps = CommonProps & TextareaHTMLAttributes<HTMLTextAreaElement> & { as: 'textarea'; mono?: boolean };

export function Field(props: InputProps | TextareaProps) {
  const generatedId = useId();
  const { label, hint, error, id = generatedId, mono, as, className, 'aria-describedby': describedBy, ...rest } = props;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const description = [describedBy, error ? errorId : hint ? hintId : undefined].filter(Boolean).join(' ') || undefined;
  const common = { id, 'aria-invalid': error ? true as const : rest['aria-invalid'], 'aria-describedby': description };
  return (
    <div className={styles.field}>
      {label && <label className={styles.label} htmlFor={id}>{label}</label>}
      {as === 'textarea' ? (
        <textarea {...rest as TextareaHTMLAttributes<HTMLTextAreaElement>} {...common} className={[styles.textarea, className].filter(Boolean).join(' ')} />
      ) : (
        <input {...rest as InputHTMLAttributes<HTMLInputElement>} {...common} className={[styles.input, mono ? styles.inputMono : '', className].filter(Boolean).join(' ')} />
      )}
      {hint && !error && <div className={styles.hint} id={hintId}>{hint}</div>}
      {error && <div className={styles.error} id={errorId} role="alert">{error}</div>}
    </div>
  );
}
