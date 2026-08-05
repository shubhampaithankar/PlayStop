# @playstop/engine

Shared pure logic used by more than one app: `apps/api` and `apps/web` both
need it, so it lives here instead of being duplicated or living inside one
app and imported sideways into the other.

## Current state

Empty on purpose. Milestone 1 has no booking logic anywhere in this repo,
see the "Do NOT" list in the root `CLAUDE.md`. `src/index.ts` is a
placeholder export so the package builds and can be depended on once there
is something to put in it.

This is a deliberate placeholder, not an oversight: writing slot or
availability math now, before there's a real booking flow to drive its
requirements, would mean guessing at an API and rewriting it in milestone 2
anyway.

## Planned (milestone 2)

Slot and availability math: given a machine's schedule and a set of existing
bookings, what times are free. This is "pure logic" in the sense of no I/O,
no DB, no HTTP, just functions over data, which is why it's shared instead
of living in `apps/api`.

## Build

```
pnpm --filter @playstop/engine build
```

## Dependencies

May depend on `@playstop/types` once it has functions that take or return
shaped data. Depends on nothing in `apps/*`.
