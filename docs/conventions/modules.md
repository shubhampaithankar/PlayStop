# Modules and folders

One folder per thing, each with an `index.ts`.

A companion file (`constants.ts`, `utils.ts`, `controller.ts`, `route.ts`) joins a
folder **when it has something to hold**, never as an empty stub to complete the pattern. This
is why `availability` and `venue` have no `constants.ts`: there
was nothing to put in them.

```
apps/api/src/
  modules/<domain>/   route.ts -> controller.ts -> utils.ts (all functions), plus constants.ts where earned
  types/<module>.ts   module-local type declarations, one file per module
  libs/<vendor>/      third-party wrappers only: mongo, redis, sentry
  middleware/         per-request cross-cutting concerns
  routes/             index.ts mounts each module at its own prefix
                      slug-router.ts holds everything under /venues/:venueSlug

apps/web/src/
  routes/             one file per URL
  components/ui/      shadcn output, vendor territory
  lib/                api.ts, query-client.ts

packages/engine/src/
  contracts/<name>/   Zod contracts that cross the network boundary
  utils/<name>/       pure logic: grid, availability, pricing
  constants/<name>/   values shared across the contracts/utils boundary

packages/types/src/
  compute/<name>/     engine vocabulary, epoch milliseconds
  mongo/              on-disk document shapes
  <name>/             enum-like values, see constants.md
```

## Rules that hold across all of them

- A module never reaches into another module's internals. Cross-module reads go through the
  owning module's exported surface.
- Nothing under `libs/` knows what a booking is. If it needs domain knowledge it is a module.
- `apps/web` creates no `hooks/`, `types/`, `utils/` or `features/` folder until a second file
  genuinely needs one. `types/` should never appear: network shapes come from
  `@playstop/engine` and redefining one locally is the thing the shared package exists to stop.
- Where a value lives follows one rule: declared once, as close to its only consumer as
  possible, and lifted only when a second module genuinely needs it.
- `apps/api` type declarations are the one exception to co-location: a module's own types live
  in `src/types/<module>.ts`, not inline in its `utils.ts`/`constants.ts`. Mongo document shapes and
  wire contracts still come from `@playstop/types` / `@playstop/engine`; `src/types/` holds only
  api-local derived types.
