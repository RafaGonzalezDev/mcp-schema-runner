# Validation and process supervision

The launch and validation scripts own process lifecycle and repository-level checks. They do not depend on external MCP services or change application configuration outside an isolated temporary directory.

## Key components

- [dev.mjs](../../scripts/dev.mjs): launches the tsx and Vite JavaScript entries with the current Node executable. It preserves each package's working directory, binds the client to loopback, validates ports and announces readiness only after real API/client HTTP responses.
- [processes.mjs](../../scripts/processes.mjs): supervises child processes, handles spawn errors and unexpected closes, and cancels readiness checks. Exit is tracked with `close`, not `child.killed`. Shutdown has an eight-second grace period followed by forceful cleanup and a bounded close wait; roots that remain open produce a log and nonzero result.
- [processes.test.mjs](../../scripts/processes.test.mjs): portable Node tests covering spawn failure, sibling cleanup, ignored SIGTERM, surviving POSIX descendants, Windows tree escalation and cleanup failure, unexpected exits and HTTP readiness/cancellation. Process operations are injected so the assertions are deterministic on either OS.
- [smoke.mjs](../../scripts/smoke.mjs): starts the compiled backend on a temporary loopback port with temporary storage, bootstraps a bearer token, verifies authentication and built frontend assets, then exercises the local MCP fixture. It checks pagination, exact trace arguments, success and tool-level errors, disconnect/delete and subprocess cleanup. Assertions and startup failures also run cleanup in `finally`.
- [CI workflow](../../.github/workflows/ci.yml): Ubuntu/Windows and Node 22/24 matrix running locked installation, typecheck, tests, build and smoke. Jobs and individual steps have time limits.

## Commands

```sh
npm run install:ci
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke:dev
```

`npm run dev` defaults to API port 3001 and client port 5173. Override them with `PORT` and `FRONTEND_PORT`; both must be integers between 1 and 65535. Development requests are proxied to the configured API port by the client configuration.

The smoke requires the compiled server, built client and [local MCP fixture](../../server/test/fixtures/mcp-server.mjs). It does not download, connect to or launch the built-in filesystem/context7/playwright services. The port is allocated by an OS-assigned loopback listener and released immediately before backend startup; an unrelated process winning that small race causes failure, not fallback to another instance.

## Shutdown and CI limitations

POSIX children have separate process groups, allowing cleanup of descendants even after a watch-process root closes. Windows attempts `taskkill /T`, then escalates to `/T /F` after the grace period if the root remains open. The first command can reject console processes and is not equivalent to delivering Node's graceful SIGTERM handler. Forceful termination cannot guarantee application-level cleanup.

Windows cannot guarantee cleanup of orphaned descendants after their root has already exited: targeting a dead PID with `taskkill` may no longer locate its former tree. The supervisor does not introduce OS-level job objects or descendant tracking. The smoke explicitly disconnects the MCP fixture before shutting down the backend and checks known PIDs for lingering processes.

When GitHub Actions provides `RUNNER_TRACKING_ID`, the smoke passes that single reference explicitly to its fixture through `envRefs`. This retains the runner's orphan-cleanup marker without inheriting unrelated environment variables or persisting its value. Cleanup in `finally` remains the primary mechanism; a hard kill can prevent it from running.

The [development smoke](<../../scripts/dev-smoke.mjs>) launches the supervisor from a temporary directory outside the checkout, with distinct temporary ports and isolated storage. It verifies API/client HTTP readiness, the authenticated Vite proxy, rejection of an unrelated Origin and closure of both listeners after tree cleanup. It does not connect third-party demos.

## Dependencies

Node's built-in test runner, HTTP fetch, filesystem, net and child-process APIs; the installed package-local tsx/Vite entries for development. Production smoke uses only the compiled application and deterministic local MCP fixture.

Some restricted Windows sandboxes deny the test runner's default pipe-based worker isolation. `node scripts/processes.test.mjs` runs these injected tests directly in-process on supported Node versions; normal CI uses the standard isolated runner. Node 24 also accepts `node --test --test-isolation=none scripts/processes.test.mjs`.

## Verified local results — 2026-10-04

Environment: Windows, Node 24.13.0, npm 11.6.2.

- Typecheck and production build passed.
- Backend: 148 tests passed, including real SDK timeout, pending cancellation and Windows mixed-case PATH override.
- Frontend: 49 tests passed; supervisor: 9 tests passed (206 total).
- Production smoke passed with authenticated API, served UI/assets, local MCP pagination, success/error traces and fixture cleanup.
- Development smoke passed from an external cwd with custom ports, authenticated proxy, Origin denial and closed listeners.
- Both package audits reported zero known vulnerabilities, including development dependencies. The [client manifest](<../../client/package.json>) overrides Vite's esbuild dependency to `^0.28.1` for GHSA-g7r4-m6w7-qqqr; keep or remove it only after checking the resolved version and audit/build again.
- Whitespace diff checks passed. No commits were created.

Restricted sandbox runs were blocked by child-process EPERM; the successful runtime checks used individually approved wider execution. The intentional no-response MCP fixture was then adjusted to exit cleanly when stdin closes; its three real-SDK integration tests were rerun successfully without the previous Node warning.

The CI matrix is configured but has not been executed remotely in this session. Linux/Node 22 coverage therefore remains for CI. Interactive-browser visual and screen-reader checks were not performed; DOM interaction tests and computed contrast are not a substitute for those checks. Third-party demo packages were not launched by validation.

## Related ADRs

No separate architecture decision is introduced: these scripts implement the existing local-development and compiled-application lifecycle.
