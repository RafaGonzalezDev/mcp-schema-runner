# ADR-0002: Use independent canonical configuration and session environment

**Date**: 2026-10-04

**Status**: Accepted

## Context

MCP defines communication, not one universal client configuration format. Maintaining unused vendor-specific adapters adds incompatible assumptions and misleading compatibility promises. Literal environment values were previously persisted and exposed as configuration.

## Alternatives considered

### Maintain multiple external configuration adapters

Convenient import, but couples the runner to evolving client-specific formats. The existing adapters were not in the runtime flow.

### Persist encrypted values

Supports restart convenience, but requires key custody, rotation and platform-specific storage. Encryption would not remove process/output disclosure risks.

### Persist no environment metadata

Simple, but restarting gives no guidance on required variables.

## Decision

Keep one runner-specific stdio contract and remove unused external adapters. Persist explicit backend variable references and names of required session variables in versioned JSON. Keep literal values only in backend memory, resolve references immediately before connecting and expose only metadata publicly. Inherit the SDK's default safe environment instead of all backend variables. Require explicit confirmation before rewriting legacy files, without plaintext backups.

## Consequences

**Positive**: Smaller maintenance surface, truthful interoperability claims, secret-free persisted/public configuration and clear restart recovery.

**Negative**: Literal session values must be re-entered after restart; external formats require manual translation. A migration consent flow is necessary.

**Risks**: OS environment, memory and tools can still contain secrets. Values in arbitrary metadata/arguments or tool output are not automatically protected. Atomic replacement is not secure deletion of historical copies. Reject corrupt/unsupported files rather than silently losing entries.
