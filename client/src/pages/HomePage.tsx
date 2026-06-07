import styles from './HomePage.module.css';

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Configure a stdio MCP server',
    body: (
      <>
        A server is described by a JSON object with <code>command</code>,{' '}
        <code>args</code> and optionally <code>env</code> and <code>cwd</code>.
        The runner spawns it as a local subprocess and talks JSON-RPC over stdio.
      </>
    ),
  },
  {
    title: 'Connect from the app',
    body: (
      <>
        Pick a server in the inspector and press <code>connect</code>. The runner
        calls <code>initialize</code> and <code>tools/list</code> before listing
        the available tools.
      </>
    ),
  },
  {
    title: 'Inspect an inputSchema',
    body: (
      <>
        Click any tool in the right-hand panel to see its <code>inputSchema</code>.
        The runner pre-fills example arguments derived from the schema so you
        can iterate fast.
      </>
    ),
  },
  {
    title: 'Run and read the trace',
    body: (
      <>
        Edit the JSON arguments and press <code>run tool</code>. The execution
        trace shows the <code>request</code> sent, the <code>response</code> or{' '}
        <code>error</code> returned, the duration and the timestamp — exactly
        what an agent would see when invoking the tool.
      </>
    ),
  },
];

export function HomePage() {
  return (
    <div className={styles.home}>
      <header className={styles.hero}>
        <div className={styles.eyebrow}>mcp-schema-runner · v0.1</div>
        <h1 className={styles.title}>Debug stdio MCP servers locally.</h1>
        <p className={styles.lead}>
          Inspect tool schemas, execute manual tool calls and inspect raw
          request / response / error traces — everything you need to validate a
          Model Context Protocol server before plugging it into an agent.
        </p>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>How to test a server manually</h2>
          <span className={styles.sectionIndex}>01 — 04</span>
        </div>
        <ol className={styles.steps} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {STEPS.map((s, i) => (
            <li key={s.title} className={styles.step}>
              <span className={styles.stepIndex}>{String(i + 1).padStart(2, '0')}</span>
              <div className={styles.stepBody}>
                <span className={styles.stepTitle}>{s.title}</span>
                <span className={styles.stepText}>{s.body}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Reference config</h2>
          <span className={styles.sectionIndex}>05</span>
        </div>
        <p className={styles.stepText}>
          Minimum shape of a normalized config. Any MCP client (including this
          runner) accepts this format for the <code>stdio</code> transport:
        </p>
        <pre className={styles.codeBlock}>
{`{
  "id": "filesystem",
  "name": "filesystem",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "<path>"],
  "env": {},
  "cwd": "<optional working dir>"
}`}
        </pre>
      </section>
    </div>
  );
}
