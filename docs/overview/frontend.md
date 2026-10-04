# Frontend

The React client configures stdio servers, inspects schemas and executes manual calls. HTTP authentication belongs to the API module; pages never handle the session token or receive saved environment values.

## Key components

- [HomePage](../../client/src/pages/HomePage.tsx) prioritizes the offline demo shortcut and configured-server cards; each opens the inspector without adding a duplicate or starting a process. The usage guide is a native disclosure and the custom form follows the existing configurations. The form validates on blur and submit, focuses the first invalid field and permits empty command arguments. Its starter copies the bundled offline `demo` under `my-server`; reusing a built-in id reports that it is reserved. Session values and backend references remain separate, and validation errors never echo submitted values.
- [InspectorPage](../../client/src/pages/InspectorPage.tsx) owns selected tools and drafts keyed by server/tool while mounted. A compact connection bar and collapsed server configuration precede the tool rail and execution workspace. The selected tool's name/description, schema, arguments and trace form a clear read/edit/run/result flow. The first available tool is selected automatically without connecting or calling anything; existing selections and drafts survive polling and reconnects. Only the explicit “from schema” action regenerates an example. On narrow screens, tools remain before the workspace in both reading and keyboard order.
- [Hooks](../../client/src/lib/hooks.ts) keep the complete `ServersResponse` envelope in TanStack Query, expose migration metadata and subscribe to the last trace. API health is offline after a failed refetch even when old success data remain cached.
- [MigrationNotice](../../client/src/components/shell/MigrationNotice.tsx) requires explicit confirmation before rewriting a legacy configuration without literal environment values. Existing values remain in backend memory for that session; after restarting, the inspector requests replacement values.
- [ServerSelect](../../client/src/components/shell/ServerSelect.tsx) supports roving focus, arrows, Home/End, typeahead, Escape and Tab. [Field](../../client/src/components/primitives/Field.tsx) associates generated ids, labels, hints and errors without forwarding wrapper props to native controls.

## Environment handling

`env` contains values used only for the current backend session. `envRefs` maps child variable names to backend variable names, for example `API_KEY=BACKEND_API_KEY`; references are saved without resolving their values in the UI. The inspector displays names and references only. Replacement session values use password inputs, submit the exact set of `sessionEnvKeys`, and clear those inputs after success. Disconnect before replacing values. Missing backend references must be resolved in the backend environment.

Migration-pending metadata disables state-changing and execution actions. The UI never automatically approves a migration. Failed saves preserve the form and error message. Tool arguments must be a JSON object; traces show the arguments passed to the SDK and its result, not a JSON-RPC envelope.

## Dependencies

React owns page-local drafts and presentation state. TanStack Query owns API state, mutations and reactive last-trace data. Tests use a real QueryClient and mock only HTTP functions, including health success followed by failed refetch, migration confirmation, draft preservation and environment replacement.

## Layout validation

The redesign passes the client typecheck, all 60 frontend tests and the production build. Chrome captures of Home and Inspector at 1920×1080 and 420×1100 were reviewed; neither page had horizontal document overflow. The inspector was checked with the bundled demo connected and its first schema selected. These checks are not a full screen-reader or WCAG audit.

## Related ADRs

No frontend-specific ADR is required: the existing page/component and QueryClient boundaries are retained.
