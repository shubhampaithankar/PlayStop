# @playstop/engine

Shared pure logic used by more than one app: `apps/api` and `apps/web` both need it, so it lives
here instead of being duplicated or living inside one app and imported sideways into the other.
No I/O, no DB, no HTTP, just functions over data, which is why it has no network dependency and
runs offline.

## Exports

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

43 cases, `node --test` against the compiled output, no network. Covers both DST directions in
both hemispheres, every midnight-crossing case, the claim-cell split, and pricing. This is the
fast loop: pure-function tests catch timezone bugs a developer with no internet connection can
still run and fix.

## Build

```
pnpm --filter @playstop/engine build
```

## Dependencies

Depends on `@playstop/types` for the shapes it takes and returns. Depends on nothing in
`apps/*`.
