# Project: PlayStop

> Follow global rules at @~/.claude/CLAUDE.md. This file only adds project-specific
> facts and overrides, it never relaxes or contradicts a global rule.

## Stack
- Language: TypeScript 5.x, strict
- Web: Vite + React 19 + Tailwind CSS v4 (`@tailwindcss/vite`)
- API: Express 5 + Zod + MongoDB (native driver, no Mongoose) + Redis (ioredis), dev and prod
  both run compiled output (`tsc -w` + `node --watch`)
- Types: `packages/types` is declarations only, zero runtime, zero dependencies
- Engine: `packages/engine` holds everything with runtime behaviour: Zod contracts, their
  inferred types, shared constants, and the pure logic (slot grid, availability, pricing)
- Package manager: pnpm workspaces (`packageManager` pinned in root `package.json`)

## Commands
- `pnpm install` (root)
- `pnpm build` builds every package in dependency order. To build one app and only what it needs: `pnpm --filter "@playstop/api..." build`.
- `pnpm dev:web` (port 5173) / `pnpm dev:api` (port 3001)
- `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test`
- `pnpm --filter @playstop/api seed`: seed the demo venue and stations

## Workflow
- **Brainstorm before building**: `superpowers:brainstorming` to settle intent and design first.
- **Docs via Context7**: query the `context7` MCP for any library/framework/API, do not trust memory.
- **Skill before acting**: `systematic-debugging` before a bugfix, `verification-before-completion` before claiming done.

## Conventions
- Workspace packages are scoped `@playstop/*`.
- `packages/types` has no build-time dependency on `apps/*` or `packages/engine`, only the reverse.
- `apps/web` aliases `@/*` to its own `src/*`; `apps/api` aliases `#*` to its own `src/*`
  (typecheck) / `dist/*` (runtime). See `docs/ARCHITECTURE.md` for why they differ.
- API env is parsed and validated with Zod at boot (`apps/api/src/env.ts`), invalid env fails fast.
- Redis holds are advisory UX; the Mongo unique index on `slot_claims` is the correctness
  backstop. Never trust a hold as proof a cell is free. See `docs/milestone-2-spec.md` section 4.
- Test file names must not match `test-*.js` / `*-test.js` / `*_test.js` / `*.test.js` unless
  they are actual tests: `node --test`'s default glob will run anything that matches, whether or
  not it calls `test()`. Shared test helpers live in `tests/testing-support.ts` (engine:
  `packages/engine/tests/`; api: `apps/api/tests/`, mirroring the `src` layout it covers).
- Any test that starts a server (`app.listen(0)`) must close it and call `closeTestResources()`
  in a `try/finally`, not just at the end of the function. A skipped cleanup after a failed
  assertion hangs the run instead of failing it.

## Module convention
One folder per thing, each with an `index.ts`. A companion file (`constants.ts`, `utils.ts`,
`data.ts`, `controller.ts`, `route.ts`) joins a folder when it has something to hold, never as
an empty stub to complete the pattern.

- `apps/api/src/modules/<domain>/`: `route.ts` -> `controller.ts` -> `data.ts`, plus `utils.ts`
  where there is real logic. A module never reaches into another module's `data.ts`.
  `routes/index.ts` mounts each router at its own prefix; `routes/slug-router.ts` holds
  everything venue-scoped, so `resolveVenue` runs once instead of per module.
- `apps/api/src/libs/<vendor>/`: third-party wrappers only (mongo, redis, sentry). Nothing
  under `libs/` knows what a booking is.
- `packages/engine/src/contracts/<name>/`: Zod contracts that cross the network boundary.
- `packages/engine/src/utils/<name>/`: pure logic (grid, availability, pricing).
- `packages/engine/src/constants/<name>/`: a value used on BOTH sides of the contracts/utils
  boundary, or across two utils modules, is lifted here rather than declared twice.
- `packages/types/src/<name>/`: declarations only. `compute/` is engine vocabulary in epoch
  milliseconds, `mongo/` is on-disk document shapes. No runtime code, so no `constants.ts`.
- Enum-like constants are keyed objects (`CELL_STATES.FREE`), consumed with `z.nativeEnum`, and
  `satisfies` the matching union in `packages/types` so drift is a compile error rather than a
  test that has to notice.
## Testing
- `node --test` against compiled output (`dist-tests/`, kept separate from the runtime
  build in `dist/`), three layers: pure-function engine tests (fast, no I/O), low-volume
  integration tests against the shared Atlas dev database, and the concurrency proof, gated
  behind `TEST_PROFILE=ci` and only run in CI against a real Mongo replica set and Redis
  service container. Do not set `TEST_PROFILE=ci` locally against Atlas, it throttles at
  100 ops/sec and the burst will produce false failures.

## Key Files
- `apps/api/src/app.ts`: Express app assembly, cross-cutting middleware, `/health`
- `apps/api/src/env.ts`: Zod env validation, fails fast on boot with a readable error
- `apps/api/src/libs/mongo/index.ts`: Mongo client, typed collections, boot-time `createIndexes`
- `apps/api/src/libs/redis/index.ts`: ioredis client, the hold acquire/release Lua scripts
- `apps/web/src/App.tsx`: single page, pings `/health` on mount
- `packages/engine/src/utils/grid/`: `generateSlotGrid`, the DST- and midnight-crossing-aware core
- `scripts/assert-replica-set.mjs`: gates CI: proves the Mongo it's pointed at supports
  transactions before the suite runs

## Reference
- @.claude/rules/lang.md
- @README.md: local dev and deploy steps (Cloudflare Pages, Render, keepalive ping)
- @docs/ARCHITECTURE.md: layout, dependency direction, deployment topology, hard-won lessons
- @docs/milestone-2-spec.md: the booking design: data model, concurrency, API contract, tests

## Do NOT
- Add shadcn/ui, TanStack Router/Query/Table, auth, or accounts. Those are milestone 3, adding
  them now is scope creep.
- Add Docker. There is no local database by design, dev runs against the shared Atlas/Upstash
  infrastructure. See `docs/milestone-2-spec.md` section 8.
- Add a new dependency without checking `packages/types` and existing workspace deps first.
- Weaken or skip the concurrency proof (Test A / Test I in `docs/milestone-2-spec.md` section 9)
  to make it pass faster or more reliably. It is the test the milestone rests on.

## On compaction, preserve
- modified-files list, test commands and results, current plan, unresolved errors
