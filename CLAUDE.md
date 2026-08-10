# Project: PlayStop

> Follow global rules at @~/.claude/CLAUDE.md. This file only adds project-specific
> facts and overrides, it never relaxes or contradicts a global rule.

Self-serve slot booking for a physical gaming lounge: players rent a PS5, PS3, PS2 or racing
sim by the half hour. The scarcity is physical, so double-booking is a real-world failure.

## Stack
- TypeScript 5.x, strict, `exactOptionalPropertyTypes` on everywhere. Do not turn it off to make
  something compile; see the shadcn note under Conventions.
- Web: Vite + React 19 + Tailwind CSS v4 (`@tailwindcss/vite`, tokens in CSS, no config file)
- API: Express 5 + Zod + MongoDB (native driver, no Mongoose) + Redis (ioredis). Dev and prod
  both run compiled output (`tsc -w` + `node --watch`)
- `packages/types`: domain unions and structural shapes, plus one keyed const object per union.
  Zero dependencies
- `packages/engine`: everything with runtime behaviour. Zod contracts, their inferred types,
  shared constants, and the pure logic (slot grid, availability, pricing)
- pnpm workspaces, `packageManager` pinned in the root `package.json`

## Commands
- `pnpm install`, then `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test`
- `pnpm build` builds in dependency order. One app plus only its deps: `pnpm --filter "@playstop/api..." build`
- `pnpm dev:web` (5173) / `pnpm dev:api` (3001) / `pnpm clean` (wipes every `dist` and `dist-tests`)
- `pnpm --filter @playstop/api seed`: seed the demo venue and 15 stations
- One test file: build the package, then `node --test dist-tests/<file>.test.js` from that package
- One test by name: `node --test --test-name-pattern="spring forward" dist-tests/`

## Workflow
- **Docs via Context7**: query the `context7` MCP for any library or API, do not trust memory.
- **Skill before acting**: `systematic-debugging` before a bugfix, `verification-before-completion`
  before claiming done.

## Conventions
- Workspace packages are scoped `@playstop/*`. `packages/types` depends on nothing; everything
  else may depend on it.
- `apps/web` aliases `@/*` to its `src/*`; `apps/api` aliases `#*` to `src/*` (typecheck) and
  `dist/*` (runtime). `docs/ARCHITECTURE.md` explains why they differ.
- API env is Zod-validated at boot (`apps/api/src/env.ts`); invalid env fails fast.
- **Parse API responses, never cast them.** `as SomeResponse` is a compile-time lie: a tightened
  regex or `min`/`max` in a contract will not fail typecheck, only production.
- The web client never sends `X-Request-Id`. The API always generates its own and ignores the
  header; the client reads it off the response.
- `apps/web/src/components/ui/` is shadcn output. Theme through the CSS variables in `index.css`,
  do not hand-edit. Two files carry a documented one-line fix, see `apps/web/README.md`.
- Test filenames must not match `test-*.js` / `*-test.js` / `*_test.js` / `*.test.js` unless they
  are tests: `node --test`'s glob runs anything matching, whether or not it calls `test()`.
- Any test that starts a server must release it in a `try/finally` via the shared `teardown`
  helper. A skipped cleanup after a failed assertion hangs the run instead of failing it.

## Module convention
One folder per thing, each with an `index.ts`. A companion file (`constants.ts`, `utils.ts`,
`data.ts`, `controller.ts`, `route.ts`) joins a folder when it has something to hold, never as an
empty stub to complete the pattern.

- `apps/api/src/modules/<domain>/`: `route.ts` -> `controller.ts` -> `data.ts`. A module never
  reaches into another module's `data.ts`. `routes/index.ts` mounts each router at its own prefix;
  `routes/slug-router.ts` holds everything venue-scoped so `resolveVenue` runs once.
- `apps/api/src/libs/<vendor>/`: third-party wrappers only. Nothing here knows what a booking is.
- `apps/web/src/`: `routes/` (one file per URL), `components/ui/` (shadcn, vendor), `lib/`.
  No `hooks/`, `types/`, `utils/` until a second file needs one. Network shapes come from
  `@playstop/engine`; never redefine one locally.
- `packages/engine/src/`: `contracts/<name>/` (Zod), `utils/<name>/` (pure logic),
  `constants/<name>/` (used on both sides of that boundary).
- `packages/types/src/`: `compute/` is engine vocabulary in epoch milliseconds, `mongo/` is
  on-disk shapes. An enum-like value gets its own folder holding a keyed const object plus the
  union derived from it, so there is one declaration and nothing to keep in sync. `engine`
  imports the object and passes it to `z.nativeEnum`.

## Testing
`node --test` against compiled output in `dist-tests/`, kept out of the shipped `dist/`. Three
layers: pure engine tests (fast, no I/O), low-volume integration tests against the shared Atlas
dev database, and the concurrency proof gated behind `TEST_PROFILE=ci`, which runs only in CI
against a real Mongo replica set. **Never set `TEST_PROFILE=ci` locally**: Atlas M0 throttles at
100 ops/sec and the burst produces failures indistinguishable from real race conditions.

## Key Files
- `apps/api/src/app.ts`: app assembly, middleware order, `trust proxy`, `/health`
- `apps/api/src/libs/mongo/index.ts`: client, typed collections, boot-time `createIndexes`
- `apps/api/src/libs/redis/index.ts`: ioredis client, hold acquire/release Lua scripts
- `apps/web/src/lib/api.ts`: the client's single network choke point, parsing and typed errors
- `packages/engine/src/utils/grid/`: `generateSlotGrid`, the DST and midnight-crossing core
- `scripts/assert-replica-set.mjs`: CI gate, proves Mongo supports transactions before the suite

## Reference
- @.claude/rules/lang.md
- @README.md: local dev and deploy (Cloudflare Pages, Render, keepalive ping)
- @docs/ARCHITECTURE.md: layout, dependency direction, deployment, hard-won lessons
- @docs/milestone-2-spec.md: booking design, data model, concurrency, API contract
- @DESIGN.md: binding design contract for the web app
- @docs/milestone-3-spec.md: web implementation spec, hold lifecycle, error mapping

## Do NOT
- Trust a Redis hold as proof a cell is free. Holds are advisory UX; the unique index on
  `slot_claims` is the only correctness backstop.
- Weaken or skip the concurrency proof to make it pass faster. It is what the milestone rests on.
- Add TanStack Table. It was evaluated and dropped: nothing in this UI is tabular.
- Add Docker or a local database. Dev runs against the shared Atlas and Upstash by design.
- Add a dependency without checking the workspace packages first.

## On compaction, preserve
- modified-files list, test commands and results, current plan, unresolved errors
