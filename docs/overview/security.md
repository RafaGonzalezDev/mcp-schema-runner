# Local HTTP security

The Express application exposes stdio process control only through a local, checked API. It does not isolate the executables or tools it runs.

## Key components

- [Application factory](<../../server/src/app.ts>): side-effect-free middleware composition, JSON size limit, public bootstrap routes, authenticated API and safe error responses.
- [Local boundary](<../../server/src/api/security.ts>): exact loopback Host/Origin allowlists, cross-site rejection, random token and constant-time token comparison.
- [Entrypoint](<../../server/src/index.ts>): loopback binding, validated settings, bounded shutdown and built-client serving.
- [API client](<../../client/src/lib/api.ts>): shared in-memory bootstrap, authenticated fetches and read-only retry after token expiration.

Only health and session bootstrap are unauthenticated; Host/Origin checks and no-store headers still apply. CLI requests without Origin are allowed after valid Host checks. X-Forwarded headers do not change the allowlist. Development frontend origins are the exact configured loopback frontend port; production uses the backend origin. Allowlists account for the browser's default HTTP port normalization (port 80); inbound hosts/origins are still matched exactly, without accepting userinfo, extra paths or other URL aliases.

Requests validate canonical shapes and reject unknown fields. Storage/transport internals do not flow directly into error responses. The runner does not log request bodies, token headers or resolved environment values. Raw MCP output and inherited stderr may expose anything the tool emits; the user must trust the command and avoid sharing sensitive traces.

## Dependencies

Express middleware and Node crypto; the route layer depends on the MCP manager and configuration store. The frontend must bootstrap before protected reads/mutations. A malicious local program with equivalent permissions is outside this boundary.

## Related ADRs

[ADR-0001](<../adr/ADR-0001-enforce-local-api-boundary.md>) defines the local trust boundary. [ADR-0002](<../adr/ADR-0002-use-canonical-session-environment.md>) defines environment separation.
