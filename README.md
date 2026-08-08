# PlayStop

Multi-tenant self-serve booking for a physical gaming lounge. Customers book a station or a time
slot themselves, no counter staff required. This repository is milestones 1 and 2: a pnpm
monorepo that builds, deploys, runs CI green, and now has a working booking API behind it.
The web UI, auth, and accounts arrive in milestone 3.

## Structure

```
apps/web         Vite + React + TypeScript + Tailwind CSS v4
apps/api         Express + TypeScript + Zod, MongoDB + Redis, the booking API
packages/types    Shared TypeScript types and Zod schemas
packages/engine   Shared pure logic: slot grid, availability, pricing
```

See `docs/ARCHITECTURE.md` for the dependency direction and module layout, and
`docs/milestone-2-spec.md` for the full booking design.

## Local development

Requires Node 20+ and pnpm (`packageManager` is pinned in the root `package.json`,
run `corepack enable` once if pnpm is not already installed globally).

```
pnpm install
pnpm --filter @playstop/types build    # run once, and again after editing packages/types
pnpm --filter @playstop/engine build   # run once, and again after editing packages/engine
pnpm dev:api                            # http://localhost:3001
pnpm dev:web                            # http://localhost:5173
```

There is no local database. `apps/api` talks to a shared MongoDB Atlas dev database and an
Upstash Redis dev database over the public internet, both in Singapore, both provisioned ahead of
time (see `docs/milestone-2-spec.md` section 8). Copy `apps/web/.env.example` to `apps/web/.env`
and `apps/api/.env.example` to `apps/api/.env`, and fill in the connection strings, see
`apps/api/README.md` for the full env var list.

Seed one demo venue and 15 stations with `pnpm --filter @playstop/api seed`.

## Checks

```
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

These four are what CI runs on every push to `main` and every pull request
(`.github/workflows/ci.yml`). `pnpm test` runs the fast pure-function engine suite and low-volume
integration tests locally; the concurrency proof only runs in CI (`TEST_PROFILE=ci`), against a
throwaway Mongo replica set and Redis, never against the shared Atlas dev database. See
`apps/api/README.md` and `docs/ARCHITECTURE.md` for why.

To wipe every build output at once:

```
pnpm clean
```

## Deployment

### API on Render

Render reads `render.yaml` at the repo root. Steps in the Render dashboard:

1. New, Blueprint, connect this repository. Render finds `render.yaml` automatically and
   proposes the `playstop-api` service, region `singapore`.
2. Set the `sync: false` environment variables Render prompts for: `WEB_ORIGIN` (the deployed
   Cloudflare Pages URL), `MONGODB_URI`, `MONGODB_DB` (`playstop`), `REDIS_URL`, `APP_ENV`
   (`prod`).
3. Deploy. The build command builds `packages/types` and `packages/engine` before `apps/api`,
   since the API imports both packages' compiled output.
4. Health check path is `/health`, Render uses it to confirm the deploy is live. It also performs
   a shallow Mongo ping, so the same check catches a database the API cannot reach.

MongoDB Atlas (M0, free) and Upstash Redis (free tier) back both this production deployment and
local development, one Atlas cluster and a pair of Upstash databases split by dev/prod database
name and scoped credentials, see `docs/milestone-2-spec.md` section 8 for the full setup and the
reasoning against Docker Compose.

Free tier note: Render's free web services spin down after 15 minutes of no traffic and take a
cold-start hit on the next request. Point an external 5-minute ping at `/health` (UptimeRobot, or
a small Cloudflare Worker on a cron trigger) to keep it warm; the same ping keeps the Atlas
cluster from auto-pausing after 30 idle days. Upgrade path when traffic justifies it: a paid
Render instance, or move to Fly.io for an always-on box.

### Web on Cloudflare Pages

Cloudflare Pages is configured in their dashboard, not a file in this repo. Create a project from
this repository with:

- Build command: `pnpm --filter @playstop/types build && pnpm --filter @playstop/web build`
- Build output directory: `apps/web/dist`
- Root directory: `/` (leave as repo root, the build command handles the monorepo path itself)
- Node version: set the `NODE_VERSION` environment variable to `20`
- Environment variable: `VITE_API_URL` set to the deployed Render API URL
  (e.g. `https://playstop-api.onrender.com`)

## Module aliases

Each app aliases its own `src/` under a prefix, for local imports only. Workspace packages
(`@playstop/types`, `@playstop/engine`) are already aliased by name via pnpm, no path alias
needed for those.

- `apps/web`: `@/*` → `src/*`. Set in `tsconfig.json` (`paths`) and `vite.config.ts`
  (`resolve.alias`), Vite doesn't read tsconfig `paths`.
- `apps/api`: `#*` (e.g. `#env.js`) → `src/*` at typecheck (`tsconfig.json` `paths`), → `dist/*`
  at runtime (`package.json` `imports` field, native Node subpath imports). `tsc` doesn't rewrite
  import specifiers on emit, so a bare `paths` entry alone typechecks but breaks at runtime, this
  is why `apps/api` needs a second, Node-native mechanism where `apps/web` doesn't. Pattern is
  `#*` not `#/*`, Node's ESM loader rejects a specifier that starts with `#/`.

## Repo docs

- `docs/ARCHITECTURE.md`: layout, dependency direction, deployment topology, lessons that cost
  debugging time
- `docs/milestone-2-spec.md`: the booking design: data model, concurrency, API contract, tests
- `apps/api/README.md`: API run, env vars, endpoints, seed script, tests
- `apps/web/README.md`: web run, env vars, Tailwind v4 setup
- `packages/types/README.md`: shared types and schemas, what lives here and why
- `packages/engine/README.md`: shared pure logic: grid, availability, pricing

## Not yet built

shadcn/ui, TanStack Router/Query/Table, the booking UI, auth, and accounts land in milestone 3
and are not yet in this repository. Docker is not planned at all: local development runs against
the same Atlas and Upstash infrastructure as production, see `docs/milestone-2-spec.md` section 8
for why that's a deliberate, permanent choice rather than a deferred one.
