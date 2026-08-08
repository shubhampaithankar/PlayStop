# @playstop/types

Shared TypeScript types and Zod schemas consumed by `@playstop/web` and `@playstop/api`. Both
sides of the network boundary validate against the same definition instead of two hand-maintained
copies drifting apart.

## Build

```
pnpm --filter @playstop/types build
```

Run this once after cloning and again after any edit here. `apps/api` and `apps/web` import the
compiled output (`dist/`), not the TypeScript source directly.

## Layout

- `src/api/`: request and response contracts, anything that crosses the web-to-api network
  boundary: `health.ts`, `venue.ts`, `availability.ts`, `hold.ts`, `booking.ts`.
- `src/common/`: shared domain shapes that aren't network contracts on their own but are reused
  by both the API and `packages/engine`:
  - `primitives.ts`: `objectIdSchema`, `isoInstantSchema` (requires a literal `Z`),
    `localDateSchema`, `idempotencyKeySchema`
  - `cell.ts`: `cellStateSchema` (the six availability states), `availabilityCellSchema`
  - `station.ts`: `stationKindSchema`, `stationSummarySchema`
  - `error.ts`: `errorCodeSchema` (the closed set of API error codes), `apiErrorSchema`
- `src/index.ts` re-exports both `src/api/index.ts` and `src/common/index.ts`.

Each schema exports its inferred type alongside it, e.g. `export type HealthResponse =
z.infer<typeof healthResponseSchema>`.

## Rule

Any data that crosses the network between web and api gets its schema defined here first, under
`src/api/`. Domain shapes that both `apps/api` and `packages/engine` need but that never cross
the wire directly go under `src/common/`. Don't redefine a request, response, or domain shape
locally in `apps/web`, `apps/api`, or `packages/engine`.

This package depends on nothing in `apps/*` or `packages/engine`. The dependency direction only
ever goes the other way.
