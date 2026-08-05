# @playstop/types

Shared TypeScript types and Zod schemas consumed by `@playstop/web` and
`@playstop/api`. This package replaces the old `packages/shared`, split out
so both sides of the network boundary validate against the same definition
instead of two hand-maintained copies drifting apart.

## Build

```
pnpm --filter @playstop/types build
```

Run this once after cloning and again after any edit here. `apps/api` and
`apps/web` import the compiled output (`dist/`), not the TypeScript source
directly.

## Layout

- `src/api/` — request and response contracts, anything that crosses the
  web-to-api network boundary. Each schema exports its inferred type
  alongside it, e.g. `export type HealthResponse = z.infer<typeof
  healthResponseSchema>`.
- `src/common/` — shared domain types that aren't network contracts. Empty
  for now, milestone 2 (booking, slots, availability) adds to it.
- `src/index.ts` re-exports both.

## Exports

- `healthResponseSchema` / `HealthResponse`: the shape of the API's
  `/health` response, `{ status: "ok", uptime: number }`.

## Rule

Any data that crosses the network between web and api gets its schema
defined here first, under `src/api/`, then imported on both ends. Don't
redefine a request or response shape locally in `apps/web` or `apps/api`.

This package depends on nothing in `apps/*` or `packages/engine`. The
dependency direction only ever goes the other way.
