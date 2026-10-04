## 2026-10-04 — Harden the local runner

**What**: Replace unused client-specific adapters with one validated canonical stdio contract; introduce session-only environment values, persistent references, explicit legacy migration and atomic metadata writes. Protect the loopback API with Host/Origin checks and per-start Bearer authentication.

**Where**: [Shared contract](<../../shared/types.ts>), [storage](<../../server/src/storage/configStore.ts>), [HTTP app](<../../server/src/app.ts>), [security](<../../server/src/api/security.ts>), [routes](<../../server/src/api/routes.ts>) and [client API](<../../client/src/lib/api.ts>).

**Why**: Prevent misleading interoperability claims, persisted/public secrets, exposure of process control and silent data loss. See [ADR-0001](<../adr/ADR-0001-enforce-local-api-boundary.md>) and [ADR-0002](<../adr/ADR-0002-use-canonical-session-environment.md>).

## 2026-10-04 — Make connections, UI and launch reproducible

**What**: Track pending MCP connections, cancellation, failures and complete tool pagination; keep exact SDK argument/result traces. Repair compiled paths and cwd handling, serve production UI with the API, and supervise development process trees. Improve keyboard navigation, labels, contrast, draft/trace reactivity and environment recovery. Add deterministic integration tests, smoke and CI; update vulnerable dependency resolutions and the test runner for confirmed security advisories.

**Where**: [MCP manager](<../../server/src/mcp/manager.ts>), [path resolver](<../../server/src/config/projectPaths.ts>), [launch scripts](<../../scripts/dev.mjs>), [Inspector](<../../client/src/pages/InspectorPage.tsx>), [Home](<../../client/src/pages/HomePage.tsx>), [smoke](<../../scripts/smoke.mjs>) and [CI](<../../.github/workflows/ci.yml>).

**Why**: Fix connection races, startup failures, inaccurate state and inaccessible controls without changing the product architecture. Validation outcomes and limits belong in [validation overview](<../overview/validation.md>).

## 2026-10-04 — Make the first example testable

**What**: Add a bundled offline demo MCP server (`echo`, `add`, `now`) exposed as the built-in `demo`, and stop pre-filling the add-server form with the reserved `filesystem` id that made the untouched example fail validation. Reusing a built-in id now reports that it is reserved.

**Where**: [demo server](<../../server/examples/demo-server.mjs>), [built-in fixtures](<../../shared/fixtures.ts>), [Home form](<../../client/src/pages/HomePage.tsx>) and [fixture tests](<../../server/src/config/fixtures.test.ts>).

**Why**: The pre-configured example could not be added or verified without editing the id and downloading a third-party package.
