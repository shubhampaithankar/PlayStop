# PlayStop

Multi-tenant self-serve booking for a physical arcade. Customers book a machine
or a time slot themselves, no counter staff required. This repository is
milestone 1: a pnpm monorepo that builds, deploys, and runs CI green. The app
itself is intentionally thin, one page on the web side, one route on the API
side. Booking logic, auth, and storage arrive in later milestones.

## Structure

```
apps/web         Vite + React + TypeScript + Tailwind CSS v4
apps/api         Express + TypeScript + Zod
packages/types    Shared TypeScript types and Zod schemas
packages/engine   Shared pure logic (empty placeholder, milestone 2)
```

## Local development

Requires Node 20+ and pnpm (`packageManager` is pinned in the root `package.json`,
run `corepack enable` once if pnpm is not already installed globally).

```
pnpm install
pnpm --filter @playstop/types build   # run once, and again after editing packages/types
pnpm dev:api                            # http://localhost:3001
pnpm dev:web                            # http://localhost:5173
```

Copy `apps/web/.env.example` to `apps/web/.env` and `apps/api/.env.example` to
`apps/api/.env` if you need to change the defaults (API URL, port, allowed
origin).

## Checks

```
pnpm typecheck
pnpm lint
pnpm build
```

These three are what CI runs on every push to `main` and every pull request
(`.github/workflows/ci.yml`).

To wipe every build output at once:

```
pnpm clean
```

## Deployment

### API on Render

Render reads `render.yaml` at the repo root. Steps in the Render dashboard:

1. New, Blueprint, connect this repository. Render finds `render.yaml`
   automatically and proposes the `playstop-api` service.
2. Set the `WEB_ORIGIN` environment variable to the deployed Cloudflare Pages
   URL (it is marked `sync: false` in `render.yaml` so Render will prompt for
   it rather than guessing).
3. Deploy. The build command builds `packages/types` before `apps/api`, since
   the API imports that package's compiled output.
4. Health check path is `/health`, Render uses it to confirm the deploy is live.

Free tier note: Render's free web services spin down after 15 minutes of no
traffic and take a cold-start hit on the next request. Point an external
5-minute ping at `/health` (UptimeRobot, or a small Cloudflare Worker on a
cron trigger) to keep it warm. Upgrade path when traffic justifies it: a paid
Render instance, or move to Fly.io for an always-on box.

### Web on Cloudflare Pages

Cloudflare Pages is configured in their dashboard, not a file in this repo.
Create a project from this repository with:

- Build command: `pnpm --filter @playstop/types build && pnpm --filter @playstop/web build`
- Build output directory: `apps/web/dist`
- Root directory: `/` (leave as repo root, the build command handles the
  monorepo path itself)
- Node version: set the `NODE_VERSION` environment variable to `20`
- Environment variable: `VITE_API_URL` set to the deployed Render API URL
  (e.g. `https://playstop-api.onrender.com`)

## Module aliases

Each app aliases its own `src/` under a prefix, for local imports only.
Workspace packages (`@playstop/types`, `@playstop/engine`) are already
aliased by name via pnpm, no path alias needed for those.

- `apps/web`: `@/*` → `src/*`. Set in `tsconfig.json` (`paths`) and
  `vite.config.ts` (`resolve.alias`), Vite doesn't read tsconfig `paths`.
- `apps/api`: `#*` (e.g. `#env.js`) → `src/*` at typecheck (`tsconfig.json`
  `paths`), → `dist/*` at runtime (`package.json` `imports` field, native
  Node subpath imports). `tsc` doesn't rewrite import specifiers on emit, so
  a bare `paths` entry alone typechecks but breaks at runtime, this is why
  `apps/api` needs a second, Node-native mechanism where `apps/web` doesn't.
  Pattern is `#*` not `#/*`, Node's ESM loader rejects a specifier that
  starts with `#/`.

## Repo docs

- `docs/ARCHITECTURE.md` — layout, dependency direction, deployment topology
- `apps/api/README.md` — API run, env vars, endpoints
- `apps/web/README.md` — web run, env vars, Tailwind v4 setup
- `packages/types/README.md` — shared types and schemas, what lives here and why
- `packages/engine/README.md` — shared pure logic, placeholder for milestone 2

## Out of scope for milestone 1

shadcn/ui, TanStack Router/Query/Table, MongoDB, Mongoose, Redis, Docker,
Turborepo, tests, auth, and any booking logic. Those land in milestone 2.
