# Constants and enum-like values

An enum-like value is declared **once**, as a keyed const object, with its union derived from
it. There is no second list to keep in sync.

```ts
// packages/types/src/cell-state/index.ts
export const CELL_STATES = {
  FREE: "free",
  HELD: "held",
  BOOKED: "booked",
  MAINTENANCE: "maintenance",
  PAST: "past",
  TOO_FAR_AHEAD: "too_far_ahead",
} as const;

export type CellState = (typeof CELL_STATES)[keyof typeof CELL_STATES];
```

`packages/engine` imports the object and hands it to `z.nativeEnum(CELL_STATES)`, so the wire
schema, the type, and every call site come from the same declaration.

Call sites read `CELL_STATES.FREE`, not a bare `"free"`, so a typo is a compile error.

## Why the object lives in `packages/types`

`packages/types` owns these because its own shapes reference them (`AvailabilityCell` needs
`CellState`, `StationDoc` needs `StationKind`). It cannot import them from `engine`, because
`engine` already depends on `types` and that would be circular.

This is why `types` emits a small amount of JavaScript despite otherwise being declarations.
It still has **zero dependencies**.

## What this replaced, and why not to reintroduce it

The values used to be written twice: a hand-written union in `types` and a const object in
`engine`, kept in step by `satisfies` plus an `Exclude<>` exhaustiveness guard.

That worked but was worse. `satisfies` alone only catches one direction: adding a member to
the union produced **no error at all**, so the Zod contract would silently start rejecting a
legitimate value. Deriving the union removes the possibility rather than detecting it, and
deletes both guards.

## Where a shared constant goes

`packages/engine/src/constants/<name>/` holds a value used on both sides of the
contracts/utils boundary, or across two utils modules. `MS_PER_MINUTE` lives there because
grid, availability and pricing all divide by it. A value with one consumer stays with it:
`CONFIRMATION_CODE_PATTERN` is inside `contracts/booking/`.

`constants/time/` deliberately imports nothing, so pulling a number never drags luxon into a
bundle.
