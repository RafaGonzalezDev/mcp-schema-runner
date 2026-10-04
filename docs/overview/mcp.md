# MCP connection lifecycle

The MCP manager owns stdio subprocess connections, their initialization, tool inventory, and manual tool calls. It is the only runtime component that creates MCP transports. HTTP routes authorize access and obtain session configuration from storage; the manager does not persist metadata or literal environment values.

## Key components

- `McpManager`: tracks pending and established connections by server identifier, including cancellation, cleanup, and retryable errors.
- `McpOperationError`: stable operation codes consumed by the HTTP layer.
- Injected client and transport factories: deterministic lifecycle and protocol tests without launching subprocesses.

## Connection states and cleanup

A connect request installs a `connecting` entry before awaiting initialization. Concurrent requests for that identifier share the pending operation rather than spawning another process. Connecting an already live server reuses the connection. Initialization includes `tools/list`; failure closes both client and transport and leaves a retryable error state.

Disconnect marks the close as intentional, aborts pending SDK requests, closes both resources, waits for the pending initialization operation, and removes that generation. Unexpected closes clear the inventory and PID and report an error instead of leaving a stale connected state. Callbacks verify connection identity so callbacks from an old generation cannot modify a replacement connection.

A new connect is rejected while cleanup is pending. Shutdown prevents further connections and disconnects every tracked generation. Cleanup attempts the transport close even if client close fails.

## Environment boundary

The transport receives only explicit configuration environment values: resolved `envRefs` plus literal session values. It never receives the entire parent environment. The SDK separately inherits its documented default safelist, such as PATH and HOME; that default is not an isolated-process sandbox.

Missing reference sources or required session keys block connection before either factory runs. Empty strings count as supplied values. Target environment key overlap is case-insensitive on Windows and case-sensitive elsewhere. Windows explicit keys are uppercased before the SDK default-environment merge so an override such as `Path` cannot lose to the default `PATH`. Backend reference lookup is also case-insensitive on Windows. NUL values are rejected before process creation; empty strings and legitimate newlines are allowed. Public server state omits literal environment values and includes missing key names, never their values.

Servers run with the user's permissions and may perform arbitrary actions. Connecting a configured command is an execution decision, not a safe preview; the local HTTP authorization boundary remains essential.

## Tool inventory

The manager follows every `nextCursor`, with timeout and cancellation on each request. It detects repeated cursors and caps pagination to prevent an unbounded loop. Inventory refresh replaces the cache only after all pages succeed and only if the original connection is still current and not aborted. A failed refresh leaves the previous complete inventory intact.

## Execution traces

Tool arguments must be a plain JSON object; nulls, arrays, and scalar values are rejected without calling the SDK. The request object is cloned and that exact object is passed to `callTool` and included in the trace. Tool-level `isError` results become error traces; protocol exceptions become serializable message/name/code details without raw Error objects or stacks.

Traces are application-level argument and result records, not complete JSON-RPC wire captures. They include duration and timestamp. Tool results can themselves contain sensitive data, so trace output should not be treated as sanitized logging.

## Dependencies

The manager depends on the MCP TypeScript SDK, shared configuration/state contracts, and server-side path expansion. Storage remains responsible for migration and environment metadata; HTTP routes remain responsible for authorization and blocking migration-pending connections.
