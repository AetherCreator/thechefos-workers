// V5 fictional-field detection is handled by zod .strict() in schema.ts.
// This file is an architectural slot for v1.1+:
//   - severity ladder for soft-warning unknown keys (e.g. "experimental_*" prefix)
//   - per-agent whitelist deltas
//   - documented schema-candidate allowlist
//
// v1: intentionally empty. zod .strict() covers the invariant structurally.

export const WHITELIST_VERSION = 'v1.0'
