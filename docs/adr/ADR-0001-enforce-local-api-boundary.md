# ADR-0001: Enforce a local API boundary

**Date**: 2026-10-04

**Status**: Accepted

## Context

The API launches arbitrary user-chosen stdio executables. A wildcard bind and permissive credentialed CORS would expose this capability to other devices and websites. The application is a single-user local development tool, not a network service.

## Alternatives considered

### Loopback without request authentication

Simple, but web-origin access and DNS rebinding remain risks; a local bind alone does not define the trust boundary.

### Network deployment with accounts and TLS

Would support remote use but require significantly more authorization and process isolation, outside the product scope.

## Decision

Bind to 127.0.0.1, validate exact local Host/Origin values, reject cross-site metadata, and authenticate protected API operations with a random per-start token bootstrapped only through the checked local session endpoint. Serve production UI/API on the same origin and proxy development API requests through Vite. Keep token only in memory and disable API caching. Do not automatically replay mutations on token expiration.

## Consequences

**Positive**: Smaller supported trust boundary and reduced exposure to unrelated websites and network devices. No external authentication service.

**Negative**: Other devices cannot access the application; clients need bootstrap authentication and restart handling. This is not an account system.

**Risks**: Local processes with the same permissions can access bootstrap. Executed MCP servers retain OS permissions; token/Origin checks are not sandboxing. Tool results and stderr may contain sensitive values.
