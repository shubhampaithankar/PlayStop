# @playstop/shared

Zod schemas shared by `@playstop/web` and `@playstop/api`. This package
exists so both sides of the network boundary validate against the same
definition instead of two hand-maintained copies drifting apart.

## Build

```
pnpm --filter @playstop/shared build
```

Run this once after cloning and again after any edit here, `apps/api` and
`apps/web` import the compiled output (`dist/`), not the TypeScript source
directly.

## Exports

- `healthResponseSchema` (and its inferred `HealthResponse` type): the shape
  of the API's `/health` response, `{ status: "ok", uptime: number }`.

## Rule

Any data that crosses the network between web and api gets its schema
defined here first, then imported on both ends. Don't redefine a shape
locally in `apps/web` or `apps/api` if it represents a request or response
body, that's what this package is for.

This package depends on nothing in `apps/*`, the dependency direction only
ever goes the other way.
