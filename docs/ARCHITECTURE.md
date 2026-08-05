# Architecture

## Layout

pnpm workspace monorepo, three packages:

```
apps/web          Vite + React 19 + TypeScript + Tailwind CSS v4, one page
apps/api          Express 5 + TypeScript + Zod, one route (/health)
packages/types    Zod schemas and TypeScript types shared by both apps
packages/engine   Shared pure logic (empty placeholder, milestone 2 fills it)
```

Each has its own `README.md` for specifics. This file is the map between them.

## Dependency direction

`apps/web` and `apps/api` both depend on `packages/types`. `packages/engine`
may depend on `packages/types` once it has functions that take or return
shaped data, but not on either app. `packages/types` depends on neither
`apps/*` nor `packages/engine`. The direction only ever goes app or engine
toward types, never the reverse.

Any shape that crosses the web-to-api network boundary is defined once in
`packages/types/src/api/` and imported on both sides, never redefined
locally. Shared domain types that aren't network contracts live in
`packages/types/src/common/`.

## Module aliases

Three separate mechanisms, chosen per what each context can actually read:

- `apps/web/src/*` → `@/*`. Both a `paths` entry in `tsconfig.json` (so
  typecheck and editors resolve it) and a `resolve.alias` entry in
  `vite.config.ts` (so the bundle resolves it). Vite does not read tsconfig
  `paths`, the two have to be kept in sync by hand.
- `apps/api/src/*` → `#*` (e.g. `#env.js`). A `paths` entry in
  `tsconfig.json` for typecheck, plus Node's native `package.json` `imports`
  field (`"#*": "./dist/*"`) for runtime resolution. `tsc` never rewrites
  import specifiers on emit, so without the `imports` field a `#`-prefixed
  import would typecheck and then throw at runtime. The pattern is `#*`, not
  `#/*`: Node's ESM loader rejects any specifier starting literally with
  `#/` (`ERR_INVALID_MODULE_SPECIFIER`), verified directly, not assumed.
  Because runtime resolution points at `dist/`, `apps/api`'s `dev` script
  also runs from `dist/` (`tsc -w` alongside `node --watch dist/server.js`)
  rather than running the TypeScript source directly, one resolution path
  instead of two.
- `@playstop/types` and `@playstop/engine` need no path alias at all, pnpm
  workspace linking already resolves them by package name.

## Deployment topology

- `apps/web` deploys to Cloudflare Pages (dashboard-configured, see root
  `README.md`).
- `apps/api` deploys to Render as a free web service (`render.yaml` at the
  repo root).
- Pages talks to Render over HTTPS via `VITE_API_URL`. Render's `WEB_ORIGIN`
  env var is set to the Pages URL and used for CORS.
- MongoDB Atlas and Upstash Redis are planned (milestone 2), not present yet.

## Package manager

The workspace uses pnpm's `hoisted` node linker (`node-linker=hoisted` in
`.npmrc`) so all installed packages live under one root `node_modules`
instead of duplicated per package. Tradeoff: this gives up pnpm's default
strict isolation, a package can end up resolving a dependency it never
declared in its own `package.json`.

## Current state vs planned

**Current (milestone 1):** deployment and CI only. The web app pings the
api's `/health` route on mount and shows the result. That is the entire
feature set, it exists to prove the pipeline: build, typecheck, lint, deploy,
CORS, env validation, all wired and green.

**Planned (milestone 2), not yet present on purpose:** shadcn/ui, TanStack
Router/Query/Table, MongoDB, Redis, booking logic, auth, tests. None of this
is an oversight, see the "Do NOT" list in the root `CLAUDE.md`. Adding any of
it before milestone 2 starts is scope creep.
