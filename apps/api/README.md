# @playstop/api

Express + TypeScript API for PlayStop. Milestone 1 is a scaffold: one route,
`/health`, wired up so the pipeline (build, deploy, CORS, env validation)
is proven before booking logic lands.

## Run locally

```
pnpm --filter @playstop/shared build   # once, or after editing packages/shared
pnpm dev:api                            # http://localhost:3001
```

## Env vars

Copy `.env.example` to `.env` to override the defaults.

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3001` | coerced to a number |
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `WEB_ORIGIN` | `http://localhost:5173` | must be a valid URL, bound to CORS |

All three are parsed with Zod in `src/env.ts` at boot. Invalid or missing
values log the field errors and exit the process immediately rather than
starting with bad config.

## Endpoints

- `GET /health` returns `{ status: "ok", uptime: number }`, validated on both
  ends against `healthResponseSchema` from `@playstop/shared`.

## Deployment

Deploys to Render as a free web service, defined in the root `render.yaml`.
Build command builds `packages/shared` first, then this package. Render
pings `/health` to confirm the deploy is live.

Free tier services spin down after 15 minutes idle and take a cold-start hit
on the next request. See `src/server.ts` for the keepalive note and the
README deploy section at the repo root for the mitigation (external ping).
