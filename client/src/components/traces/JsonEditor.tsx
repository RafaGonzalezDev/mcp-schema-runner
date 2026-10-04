import { useId, useState } from 'react';
import { Button } from '../primitives/Button';
import { exampleFromSchema, formatJson, parseJson } from '../../lib/format';
import styles from './JsonEditor.module.css';

type Props = {
  value: string;
  schema?: unknown;
  onChange: (text: string) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
};

/** Controlled editor: schema changes never replace the user's draft. */
export function JsonEditor({ value, schema, onChange, disabled, id, label = 'Tool arguments (JSON)' }: Props) {
  const reactId = useId();
  const fieldId = id ?? reactId;
  const [touched, setTouched] = useState(false);
  const parsed = parseJson(value);
  const objectValid = parsed.ok && typeof parsed.value === 'object' && parsed.value !== null && !Array.isArray(parsed.value);
  const showError = touched && !objectValid;
  const error = parsed.ok ? 'Arguments must be a JSON object.' : parsed.error;
  return (
    <div>
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        className={[styles.editor, showError ? styles.error : ''].filter(Boolean).join(' ')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        spellCheck={false}
        disabled={disabled}
        placeholder={disabled ? 'Select a tool to edit its arguments.' : '{}'}
        aria-invalid={showError}
        aria-describedby={showError ? `${fieldId}-err` : undefined}
      />
      <div className={styles.bar}>
        <div className={styles.actions}>
          <Button variant="ghost" compact onClick={() => { if (parsed.ok) onChange(formatJson(parsed.value)); }} disabled={disabled || !parsed.ok}>format</Button>
          <Button variant="ghost" compact onClick={() => onChange(exampleFromSchema(schema))} disabled={disabled || !schema}>from schema</Button>
          <Button variant="ghost" compact onClick={() => onChange('')} disabled={disabled || value.length === 0}>clear</Button>
        </div>
        {showError && <div id={`${fieldId}-err`} className={styles.errorMsg} role="alert">{error}</div>}
      </div>
    </div>
  );
}
