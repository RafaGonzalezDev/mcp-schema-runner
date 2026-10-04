# mcp-schema-runner

A local developer tool for inspecting **stdio MCP servers**: connect deliberately, browse tool schemas, edit JSON arguments and inspect application-level results and errors. React 19 + Vite 7 + TanStack Query 5, with an Express API and the MCP TypeScript SDK.

It is not an agent, a sandbox, a universal MCP configuration importer, or a complete JSON-RPC wire recorder. MCP specifies the protocol, not a single client configuration file format.

## Getting started

Use **Node 24 LTS** (recommended), Node 22.12+, or Node 20.19+. The declared range is `^20.19.0 || >=22.12.0`. npm is required. This repository has three independent packages, not npm workspaces.

```sh
npm run install:ci
npm run dev
```

The supervisor prints the frontend URL only after both services answer successfully. Defaults:

- Frontend: http://127.0.0.1:5173
- API: http://127.0.0.1:3001

`PORT` changes the backend port; `FRONTEND_PORT` changes the development frontend port. Both must be integers from 1 through 65535. Stop development with Ctrl+C. The supervisor coordinates shutdown and escalates process-tree cleanup when necessary.

### Compiled application

```sh
npm run build
npm start
```

Open http://127.0.0.1:3001 (or your configured backend port). Express serves the built frontend and API on the same origin. `vite preview` only previews static assets; it is not the supported full-application launch command.

All project paths are rooted at this checkout, independently of the working directory used to launch Node. The emitted backend entrypoint is `server/dist/server/src/index.js`.

## Use

1. Add a canonical stdio configuration, or select an optional built-in demo.
2. Select the server in Inspector and press **connect**. Nothing connects automatically.
3. Choose a tool and inspect its schema. Edit the example JSON; arguments must be an object.
4. Run the tool. Inspect the exact argument object passed to the SDK, its processed result or error, duration and timestamp.
5. Disconnect to close the process and cancel outstanding requests.

Drafts survive polling, tool switches and reconnections while Inspector remains mounted. A schema-derived example is a convenience for simple schemas, not a guarantee of full JSON Schema validation. Traces are not persisted; the UI shows the latest execution per server.

## Canonical configuration

`POST /api/servers` receives `{ "config": … }` with this runner-specific configuration:

```json
{
  "id": "my-server",
  "name": "My local MCP server",
  "transport": "stdio",
  "command": "node",
  "args": ["./my-server.mjs"],
  "cwd": ".",
  "env": { "SESSION_KEY": "entered-for-this-session-only" },
  "envRefs": { "API_KEY": "RUNNER_API_KEY" }
}
```

- `args` may be empty. Arguments are passed literally, without shell expansion or general path rewriting.
- `cwd` defaults to the checkout root; relative values resolve against that root.
- The form accepts one argument per line, not shell quoting. Use the API for an explicitly empty string argument or other representations the simplified form cannot express.
- `env` values remain in backend memory for this session only. Public configuration responses expose names, never values.
- `envRefs` maps child variable names to **explicit** backend environment variable names. References persist, resolved values do not. Set referenced variables before starting the runner.
- Values and references cannot overlap. Windows comparisons respect case-insensitive environment names.
- Missing session values or references prevent connection, with an explanation naming the missing variables.
- After restarting, use Inspector to re-enter all configured session values. Changing an active process's environment requires disconnecting first.
- `notes` and `source` (`inline` or `file`) are optional metadata. Unknown fields, malformed maps and duplicate/reserved IDs are rejected.

There are no OpenCode/Hermes adapters or automatic reads of external client configuration files.

## Storage and migration

Default storage is `server/.data/servers.json`, resolved absolutely. `MCP_CONFIG_PATH` selects another path; relative overrides are rooted at the checkout. If historical root storage is detected, startup asks you to select a file explicitly rather than guessing or merging files.

Version 2 stores server metadata, `envRefs` and `sessionEnvKeys` (names only). Writes use an exclusive temporary metadata file, file synchronization and atomic rename; the in-memory cache changes only after a successful write. Corrupt, inaccessible or unsupported documents produce an error and are not replaced with an empty collection.

Existing unversioned `{ "servers": [...] }` documents require explicit confirmation in the UI. Migration replaces the file with version 2 and enables the old literal values **only in memory for this session**. No plaintext backup is created. Failure preserves the previous file; after a restart, session values must be re-entered. Removing values from the live file is not secure erasure of old backups, filesystem snapshots or storage remnants.

## Security boundary

- HTTP listens only on `127.0.0.1`. Host/Origin checks reject unrelated hosts and web origins, including `null`; forwarded headers are not trusted.
- No permissive CORS. Vite proxies `/api` in development; production uses one origin.
- A random token is generated per backend start. The frontend bootstraps it through the checked local session endpoint and keeps it in memory; protected API requests use Bearer authentication.
- No tokens in URLs, logs, persistent browser storage or disk. API/session responses use `Cache-Control: no-store`.
- Subprocesses receive the SDK's default safe environment plus explicitly configured values/references, not the backend's complete environment.
- MCP requests time out after 30 seconds by default; `MCP_REQUEST_TIMEOUT_MS` accepts integers from 1 through 600000. Disconnect cancels pending calls.
- Shutdown rejects new work and allows 5 seconds for HTTP/MCP cleanup; the development supervisor has an 8-second grace period before escalation.

**Trust every executable and tool you connect.** MCP processes run with your OS permissions and can read files, access networks, spawn descendants and echo secrets in results or stderr. This application is not a sandbox; authentication is not protection against a malicious local process with the same permissions. The trace viewer deliberately displays tool output, which may be sensitive. Do not pass secrets through arguments, notes or arbitrary metadata: those are persisted and public.

## Optional demos

The built-ins download pinned npm packages on first use; they are not CI fixtures and never auto-connect:

| Demo | Package | Requirements |
| --- | --- | --- |
| filesystem | `@modelcontextprotocol/server-filesystem@2026.8.31` | Network to install; operates on the bundled fixtures workspace |
| context7 | `@upstash/context7-mcp@4.1.1` | Network; service credentials may be required |
| playwright | `@playwright/mcp@0.0.83` | Network and an installed Chrome browser |

Package downloads execute third-party code. CI uses a small deterministic local MCP server instead, with no external services or credentials.

## API

All endpoints except health and session require `Authorization: Bearer <token>`. Host/Origin checks apply to both bootstrap endpoints as well.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness |
| GET | `/api/session` | Local session bootstrap |
| GET | `/api/servers` | `{ servers, migrationPending }`, secret-free configurations |
| POST | `/api/servers` | Add `{ config }`; 201 |
| POST | `/api/config/migrate` | Explicit migration confirmation; 204 |
| POST | `/api/servers/:id/environment` | Replace all configured session values with `{ env }` in memory |
| DELETE | `/api/servers/:id` | Await disconnect and remove saved metadata; 204 |
| POST | `/api/servers/:id/connect` | Initialize and collect the paginated tool inventory |
| POST | `/api/servers/:id/disconnect` | Cancel and close; 204 |
| GET | `/api/servers/:id/tools` | Refresh the complete inventory |
| POST | `/api/servers/:id/tools/:toolName/call` | Call with `{ arguments: {} }`, return `{ trace }` |

Built-in demos cannot be deleted or edited. IDs must be unique across built-ins and saved servers. Errors include a safe message and a stable code; malformed input is 400, missing token 401, prohibited origin/host or fixture edits 403, missing resources 404, conflicts/missing environment/migration 409, oversized bodies 413, and MCP initialization failures 502.

## Validation and documentation

```sh
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke:dev
```

Tests cover storage/IO failures, migration, canonical validation, connection races and cancellation, HTTP security, real local stdio calls, client hooks/forms and keyboard interactions. Smoke verifies the compiled application, assets, authentication, paginated inventory, success/error traces and process cleanup using isolated temporary storage.

[CI](<.github/workflows/ci.yml>) defines Ubuntu/Windows × Node 22/24. See [validation](<docs/overview/validation.md>) for the distinction between local checks and a completed CI run.

- [Architecture](<docs/overview/architecture.md>)
- [Storage](<docs/overview/storage.md>)
- [MCP lifecycle](<docs/overview/mcp.md>)
- [Local HTTP security](<docs/overview/security.md>)
- [Frontend state and accessibility](<docs/overview/frontend.md>)
- [Decision: local boundary](<docs/adr/ADR-0001-enforce-local-api-boundary.md>)
- [Decision: independent configuration and transient environment](<docs/adr/ADR-0002-use-canonical-session-environment.md>)

## References and license

[MCP specification](https://modelcontextprotocol.io) · [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) · [Express](https://expressjs.com) · [TanStack Query](https://tanstack.com/query) · [Vite](https://vite.dev)

MIT. See [LICENSE](<LICENSE>).
