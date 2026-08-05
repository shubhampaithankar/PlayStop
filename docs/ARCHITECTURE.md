# Architecture

## Layout

pnpm workspace monorepo, three packages:

```
apps/web         Vite + React 19 + TypeScript + Tailwind CSS v4, one page
apps/api         Express 5 + TypeScript + Zod, one route (/health)
packages/shared  Zod schemas shared by both apps
```

Each has its own `README.md` for specifics. This file is the map between them.

## Dependency direction

`apps/web` and `apps/api` both depend on `packages/shared`. `packages/shared`
depends on neither app. Any shape that crosses the web-to-api network
boundary is defined once in `packages/shared` and imported on both sides,
never redefined locally.

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
