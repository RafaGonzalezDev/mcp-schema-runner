# Configuration storage

The store owns versioned server metadata and session-only environment values. It does not connect MCP servers or resolve environment references; the API handles authorization and migration confirmation, while the MCP manager builds the subprocess environment.

## Key components

- `ConfigStore`: synchronous loading, validated mutations, explicit migration, and isolated copies of runtime configuration.
- `ConfigStoreError`: stable `STORE_INVALID`, `STORE_IO`, `MIGRATION_REQUIRED`, `SESSION_ENV_INVALID`, and `NOT_FOUND` codes, without including environment values in error messages.
- Injected filesystem operations: allow deterministic read, write, sync, and rename failure tests without changing production behavior.

## Disk format

Version 2 uses `{ "version": 2, "servers": [...] }`. Configurations contain command metadata, optional `envRefs`, and `sessionEnvKeys` (names only). Literal `env` is never written, even to temporary files. Environment references map subprocess variable names to parent-process variable names; resolving them is outside the store.

Adding or saving a configuration preserves its literal environment values only in memory and derives session key names. Reloading or restarting loses these values, so the API must request any missing ones before connecting. `setSessionEnvironment` requires exactly the configured session keys, with no additions, omissions, or reference overrides; it replaces values only in memory.

## Legacy migration

A valid unversioned `{ "servers": [...] }` is legacy data. Loading it performs no writes, exposes metadata without literal environment values, and marks migration pending. Legacy `opencode` and `hermes` source metadata is normalized to `inline`; importing those external formats is no longer supported.

While pending, all store mutations except `migrate()` are blocked with `MIGRATION_REQUIRED`. The API must also block connections. Explicit migration writes version 2 atomically, then allows the old literal values for the current session only. Migration never creates a plaintext backup. If migration fails, disk remains unchanged, values remain hidden, and confirmation is still required.

Malformed documents, invalid entries, duplicate identifiers, unknown versions, and literal environment fields in version 2 fail with `STORE_INVALID`; nothing is silently dropped. Read failures other than a missing file fail with `STORE_IO`.

## Atomic mutations

Each write creates an exclusive temporary file in the destination directory with mode `0600`, writes metadata, fsyncs and closes the file, then renames it over the destination. The cache is updated only after successful replacement. Failure cleanup closes open descriptors and removes the temporary file on a best-effort basis. Windows ACLs still determine effective permissions; POSIX mode is not a substitute for an appropriate directory ACL.

This guarantees atomic replacement, not multi-process locking or directory-fsync durability after sudden power loss. The supported deployment is one application process owning the store. Lists and mutation results are deep copies, preventing caller mutations from changing the cache.

Environment key overlap and duplicates are case-insensitive on Windows and case-sensitive elsewhere. Session replacement always requires the exact configured spellings.

## Dependencies

The module uses Node filesystem, path, crypto, and structured cloning facilities, plus the shared canonical configuration validator. HTTP routes consume the store; neither the UI nor shared types perform persistence.
