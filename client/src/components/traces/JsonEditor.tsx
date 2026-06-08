import { useEffect, useId, useState } from 'react';
import { Button } from '../primitives/Button';
import { exampleFromSchema, formatJson, parseJson } from '../../lib/format';
import styles from './JsonEditor.module.css';

type Props = {
  /** Texto inicial. */
  initial?: string;
  /** Schema actual para regenerar el ejemplo. */
  schema?: unknown;
  /** Notifica al padre cuando el texto cambia. */
  onChange: (text: string) => void;
  /** Deshabilita la edición. */
  disabled?: boolean;
  /** ID opcional para accesibilidad. */
  id?: string;
};

export function JsonEditor({ initial, schema, onChange, disabled, id }: Props) {
  const reactId = useId();
  const fieldId = id ?? reactId;
  const [text, setText] = useState(initial ?? '');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setText(initial ?? '');
  }, [initial]);

  const parsed = parseJson(text);
  const showError = touched && !parsed.ok;

  function update(next: string) {
    setText(next);
    onChange(next);
  }

  function handleFormat() {
    if (!parsed.ok) return;
    update(formatJson(parsed.value));
  }

  function handleFillExample() {
    update(exampleFromSchema(schema));
  }

  function handleClear() {
    update('');
  }

  return (
    <div>
      <textarea
        id={fieldId}
        className={[styles.editor, showError ? styles.error : ''].filter(Boolean).join(' ')}
        value={text}
        onChange={(e) => update(e.target.value)}
        onBlur={() => setTouched(true)}
        spellCheck={false}
        disabled={disabled}
        placeholder='{\n  "path": "./README.md"\n}'
        aria-invalid={showError}
        aria-describedby={showError ? `${fieldId}-err` : undefined}
      />
      <div className={styles.bar}>
        <div className={styles.actions}>
          <Button variant="ghost" compact onClick={handleFormat} disabled={disabled || !parsed.ok}>
            format
          </Button>
          <Button variant="ghost" compact onClick={handleFillExample} disabled={disabled}>
            from schema
          </Button>
          <Button variant="ghost" compact onClick={handleClear} disabled={disabled || text.length === 0}>
            clear
          </Button>
        </div>
        {showError && (
          <div id={`${fieldId}-err`} className={styles.errorMsg} role="alert">
            {parsed.ok ? '' : parsed.error}
          </div>
        )}
      </div>
    </div>
  );
}
