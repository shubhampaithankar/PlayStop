# @playstop/engine

Everything with runtime behavior that's shared by more than one app: `apps/api` and `apps/web`
both need it, so it lives here instead of being duplicated or living inside one app and imported
sideways into the other. Zod contracts, the types inferred from them, and the pure logic that
operates on them. No I/O, no DB, no HTTP.

## Exports

One folder per thing, each with an `index.ts`. A `utils.ts` or `constants.ts` joins a
folder when it has something to hold, not before.

```
src/contracts/<name>/index.ts   the Zod contract and its inferred types
src/utils/<name>/index.ts       the pure logic: grid, availability, pricing
```
- `contracts/<name>/`: every Zod contract that crosses the web-to-api network boundary (health, venue,
  availability, hold, booking) plus the shared primitives, error codes, and cell/station shapes
  they're built from. Each schema exports its inferred type alongside it, e.g. `export type
  HealthResponse = z.infer<typeof healthResponseSchema>`.
- `generateSlotGrid(venue, businessDate)`: resolves a session's opening and closing instants for
  one local business date and emits the 30-minute (or venue-configured) cell grid. Handles
  sessions that cross local midnight (a business day is the session that *opens* on that date, a
  post-midnight tail belongs to it) and both DST directions, by stepping in elapsed milliseconds
  from a single resolved anchor instant rather than doing local-time arithmetic per cell.
- `buildClaimCells(grid, startsAtMs, slotCount, bufferSlotCount)`: splits a requested booking
  range into play cells and trailing buffer cells, reading boundaries from the grid array rather
  than recomputing them, since the grid is not a uniform arithmetic sequence in local terms on a
  DST night.
- `computeAvailability(input)`: combines the grid, confirmed claims, and Redis holds into a
  per-cell state (`free` / `held` / `booked` / `maintenance` / `past` / `too_far_ahead`), with a
  fixed precedence: maintenance beats claims and holds, booked beats held.
- `priceBooking(station, gridMinutes, slotCount)`: `hourlyRateMinor * slotCount * gridMinutes /
  60`, asserted to be an integer. Money is integer minor units end to end, no floats.

## Tests

```
pnpm --filter @playstop/engine test
```

49 cases, `node --test` against the compiled output, no network: the 43 pure-function cases
(both DST directions in both hemispheres, every midnight-crossing case, the claim-cell split,
pricing) plus 6 schema cases. This is the fast loop: a developer with no internet connection can
still run and fix it.

## Build

```
pnpm --filter @playstop/engine build
```

## Dependencies

`zod` and `luxon`, plus `@playstop/types` for the hand-written shapes its functions take and
return (`VenueSchedule`, `StationInput`, `AvailabilityResult`, and so on). Depends on nothing in
`apps/*`.

`sideEffects: false` is set so a consumer that imports only a schema (e.g. `apps/web` importing
`healthResponseSchema`) doesn't pull `luxon` into its bundle: `luxon` is only ever touched by the
grid/availability functions, which stay unreferenced and get tree-shaken away.

## A concept shared with a schema

Where a compute type and a wire schema describe the same concept (a station's `kind`, a cell's
`state`, a grid's closed `reason`), the compute type lives once in `@playstop/types` and the Zod
schema here is built from it with a `satisfies` check, e.g.:

```ts
const cellStates = [...] as const satisfies readonly CellState[];
export const cellStateSchema = z.enum(cellStates);
```

If the literal array in the schema ever drifts from the imported type, the build fails at that
line instead of the drift being caught only by a runtime test.