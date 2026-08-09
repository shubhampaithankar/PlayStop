# @playstop/types

Hand-written TypeScript declarations only: interfaces, type aliases, unions. No Zod, no runtime
code, no dependencies, no JavaScript emitted. Consumed by `@playstop/engine`, `@playstop/web`, and
`@playstop/api` purely as `import type`.

## Build

```
pnpm build
```

Runs `tsc` with `emitDeclarationOnly` and produces `dist/*.d.ts`. There is nothing to run at
runtime, so consumers resolve straight from `src/` via the `types` field in `package.json`
(pnpm workspace linking) rather than importing `dist/`; the build step exists to catch this
package's own type errors and to keep a compiled declaration output around, not because anything
needs to execute it.

There is no `test` script: a declarations-only package has nothing to execute. `pnpm -r run test`
skips it.

## Layout

- `station-kind.ts`: `StationKind`, the one declaration of a station's kind, shared by
  `StationDoc.kind`, `StationInput.kind`, and (via a `satisfies` check) `@playstop/engine`'s
  `stationKindSchema`.
- `compute/`: the hand-written shapes `@playstop/engine`'s pure functions take and return, and
  nothing else -- `grid.ts` (`VenueSchedule`, `GridCell`, `GridResult`, `ClosedReason`),
  `availability.ts` (`StationInput`, `OccupiedCell`, `AvailabilityInput`, `AvailabilityResult`,
  `CellState`, `AvailabilityCell`).
- `mongo.ts`: the on-disk Mongo document shapes (`VenueDoc`, `StationDoc`, `BookingDoc`,
  `SlotClaimDoc`, `IdempotencyDoc`, `OpeningHours`), deliberately separate from the wire schemas
  in `@playstop/engine`: a Mongo document and its wire representation are not always the same
  shape (dates vs ISO strings, internal-only fields).
- `index.ts` re-exports all three.

## Rule

Anything with runtime behavior -- a Zod schema, a type inferred from one via `z.infer`, a
function -- belongs in `@playstop/engine`, not here. This package holds only structural
declarations that exist purely at compile time. Where a concept here is also validated on the
wire (a station's `kind`, a cell's `state`), the declaration here is the one source of truth and
`@playstop/engine`'s schema is built to match it, not the other way around.

This package depends on nothing: no `apps/*`, no `packages/engine`, no third-party package. The
dependency direction only ever goes the other way.