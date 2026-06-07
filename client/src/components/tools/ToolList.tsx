import type { McpToolSummary } from '../../../../shared/types';
import styles from './ToolList.module.css';

type Props = {
  tools: McpToolSummary[];
  selectedName: string | null;
  onSelect: (name: string) => void;
};

export function ToolList({ tools, selectedName, onSelect }: Props) {
  if (tools.length === 0) {
    return <div className={styles.empty}>no tools available</div>;
  }
  return (
    <ul className={styles.list}>
      {tools.map((tool) => {
        const active = tool.name === selectedName;
        const required = requiredFields(tool.inputSchema);
        return (
          <li key={tool.name}>
            <button
              type="button"
              className={[styles.row, active ? styles.active : ''].filter(Boolean).join(' ')}
              onClick={() => onSelect(tool.name)}
              aria-pressed={active}
            >
              <div className={styles.head}>
                <span className={styles.name}>{tool.name}</span>
                <span className={styles.tag}>
                  {required.length > 0 ? `${required.length} required` : 'optional args'}
                </span>
              </div>
              {tool.description && (
                <div className={styles.description}>{tool.description}</div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function requiredFields(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s['required'])) {
    return (s['required'] as unknown[]).filter((x): x is string => typeof x === 'string');
  }
  return [];
}
