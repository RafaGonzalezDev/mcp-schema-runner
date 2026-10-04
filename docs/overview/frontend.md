# Frontend

The React client configures stdio servers, inspects schemas and executes manual calls. HTTP authentication belongs to the API module; pages never handle the session token or receive saved environment values.

## Key components

- [HomePage](../../client/src/pages/HomePage.tsx) validates on blur and submit, focuses the first invalid field and permits empty command arguments. Its starter values copy the bundled offline `demo` under the distinct `my-server` id, so the untouched form submits and connects immediately; reusing a built-in id reports that it is reserved. Session values and backend variable references are separate inputs; validation errors never echo submitted values.
- [InspectorPage](../../client/src/pages/InspectorPage.tsx) owns selected tools and drafts keyed by server/tool while mounted. Polling, reconnects and schema changes do not replace drafts. Only the explicit “from schema” action regenerates an example.
- [Hooks](../../client/src/lib/hooks.ts) keep the complete `ServersResponse` envelope in TanStack Query, expose migration metadata and subscribe to the last trace. API health is offline after a failed refetch even when old success data remain cached.
- [MigrationNotice](../../client/src/components/shell/MigrationNotice.tsx) requires explicit confirmation before rewriting a legacy configuration without literal environment values. Existing values remain in backend memory for that session; after restarting, the inspector requests replacement values.
- [ServerSelect](../../client/src/components/shell/ServerSelect.tsx) supports roving focus, arrows, Home/End, typeahead, Escape and Tab. [Field](../../client/src/components/primitives/Field.tsx) associates generated ids, labels, hints and errors without forwarding wrapper props to native controls.

## Environment handling

`env` contains values used only for the current backend session. `envRefs` maps child variable names to backend variable names, for example `API_KEY=BACKEND_API_KEY`; references are saved without resolving their values in the UI. The inspector displays names and references only. Replacement session values use password inputs, submit the exact set of `sessionEnvKeys`, and clear those inputs after success. Disconnect before replacing values. Missing backend references must be resolved in the backend environment.

Migration-pending metadata disables state-changing and execution actions. The UI never automatically approves a migration. Failed saves preserve the form and error message. Tool arguments must be a JSON object; traces show the arguments passed to the SDK and its result, not a JSON-RPC envelope.

## Dependencies

React owns page-local drafts and presentation state. TanStack Query owns API state, mutations and reactive last-trace data. Tests use a real QueryClient and mock only HTTP functions, including health success followed by failed refetch, migration confirmation, draft preservation and environment replacement.

## Related ADRs

No frontend-specific ADR is required: the existing page/component and QueryClient boundaries are retained.
