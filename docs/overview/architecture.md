# Architecture

The runner has a browser UI, a checked local HTTP boundary and an MCP lifecycle manager. The backend alone launches processes and owns resolved environment values. Shared TypeScript contracts describe runner configuration and public state; they are not a standard client import format.

## Key components

- [Shared types](<../../shared/types.ts>): strict canonical input validation and metadata-only public configuration.
- [App factory](<../../server/src/app.ts>): startup-independent Express middleware for tests, security, API and compiled UI.
- [Routes](<../../server/src/api/routes.ts>): explicit user operations, built-in protections and migration/environment gates.
- [Store](<../../server/src/storage/configStore.ts>): synchronous metadata persistence and session environment memory. Reads/writes are serialized by Node's event loop; the store is not a multi-process database.
- [Manager](<../../server/src/mcp/manager.ts>): pending/established connection ownership, SDK requests, cancellation, pagination and application-level traces.
- [Entrypoint](<../../server/src/index.ts>): validated settings, loopback bind and bounded shutdown.
- [Client hooks](<../../client/src/lib/hooks.ts>): one server-query envelope, derived list, mutations and separate trace cache.
- [Inspector](<../../client/src/pages/InspectorPage.tsx>): tool selection and draft state keyed by server/tool during its mounted lifetime.

## Request flow

The UI bootstraps a checked session token and sends a canonical mutation through the same-origin API. Routes validate shape and permissions, then delegate metadata changes to the store or process requests to the manager. The manager resolves only configured environment references, starts the SDK stdio transport, initializes and gathers every tool page before marking the connection established. Public state contains variable names, references and status, not resolved values.

A tool call snapshots the actual object arguments passed to the SDK and records its processed response/error. It does not capture arbitrary JSON-RPC messages, protocol framing or stderr. Stderr is inherited by the backend console, not buffered into traces. A failed tool result remains distinguishable from a transport/protocol failure.

## Dependency boundaries

Three independent npm packages are installed explicitly; there is no npm workspace command contract. TypeScript emits shared backend imports below the server build directory; the production entrypoint follows that layout. The frontend includes shared types at build time and never imports backend modules.

Development supervises package-local tsx/Vite entrypoints and proxies the API; production serves static UI and API together through Express. Path discovery is based on the source/emitted module location and checkout manifest, not the launching process's current directory.

## Related ADRs

- [ADR-0001: local API boundary](<../adr/ADR-0001-enforce-local-api-boundary.md>)
- [ADR-0002: canonical configuration and session environment](<../adr/ADR-0002-use-canonical-session-environment.md>)
