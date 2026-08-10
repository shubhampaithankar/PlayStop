# Project: PlayStop

> Follow global rules at @~/.claude/CLAUDE.md. This file only adds project-specific
> facts and overrides, it never relaxes or contradicts a global rule.

Self-serve slot booking for a physical gaming lounge: players rent a PS5, PS3, PS2 or racing
sim by the half hour. The scarcity is physical, so double-booking is a real-world failure.

## Stack
- TypeScript 5.x, strict, `exactOptionalPropertyTypes` on everywhere
- Web: Vite + React 19 + Tailwind CSS v4 (`@tailwindcss/vite`, tokens in CSS, no config file)
- API: Express 5 + Zod + MongoDB (native driver, no Mongoose) + Redis (ioredis). Dev and prod
  both run compiled output (`tsc -w` + `node --watch`)
- `packages/types`: declarations plus the enum const objects. Zero dependencies
- `packages/engine`: everything with runtime behaviour. Zod contracts, inferred types, shared
  constants, and the pure logic (slot grid, availability, pricing)
- pnpm workspaces, `packageManager` pinned in the root `package.json`

## Commands
- `pnpm install`, then `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test`
- `pnpm build` builds in dependency order. One app plus only its deps:
  `pnpm --filter "@playstop/api..." build`
- `pnpm dev:web` (5173) / `pnpm dev:api` (3001) / `pnpm clean` (wipes every `dist`, `dist-tests`)
- `pnpm --filter @playstop/api seed`: seed the demo venue and 15 stations
- One test file: build the package, then `node --test dist-tests/<file>.test.js` from it
- One test by name: `node --test --test-name-pattern="spring forward" dist-tests/`

## Conventions
Each file in `docs/conventions/` is the source of truth for its topic. Read the relevant one
before changing code in that area; do not infer the rule from surrounding code.

- @docs/conventions/modules.md: folder-per-thing, when a companion file is earned, layouts
- @docs/conventions/constants.md: enum-like values, one declaration, union derived from it
- @docs/conventions/contracts.md: the types/engine boundary, parse never cast, headers
- @docs/conventions/testing.md: three layers, the CI gate, two expensive hazards
- @docs/conventions/naming-and-builds.md: filenames, build cleaning, filters, bundle check
- @docs/conventions/booking-correctness.md: why Redis is UX and Mongo is truth

## Workflow
- **Docs via Context7**: query the `context7` MCP for any library or API, do not trust memory.
- **Skill before acting**: `systematic-debugging` before a bugfix,
  `verification-before-completion` before claiming done.

## Project-specific facts
- Workspace packages are scoped `@playstop/*`.
- `apps/web` aliases `@/*` to its `src/*`; `apps/api` aliases `#*` to `src/*` (typecheck) and
  `dist/*` (runtime). `docs/ARCHITECTURE.md` explains why they differ.
- API env is Zod-validated at boot (`apps/api/src/env.ts`); invalid env fails fast.
- Dev runs against the shared Atlas and Upstash instances. There is no local database.
- `apps/web/src/components/ui/` is shadcn output. Theme through the CSS variables in
  `index.css`; two files carry a documented one-line fix, see `apps/web/README.md`.

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
- Trust a Redis hold as proof a cell is free.
- Weaken or skip the concurrency proof to make it pass faster.
- Add TanStack Table. It was evaluated and dropped: nothing in this UI is tabular.
- Add Docker or a local database.
- Add a dependency without checking the workspace packages first.

## On compaction, preserve
- modified-files list, test commands and results, current plan, unresolved errors
