# @playstop/api

Express + TypeScript booking API for PlayStop. MongoDB (Atlas) is the source of truth, Redis
(Upstash) backs advisory holds. See `docs/milestone-2-spec.md` for the full design and
`docs/ARCHITECTURE.md` for the module layout.

## Run locally

```
pnpm --filter @playstop/types build    # once, or after editing packages/types
pnpm --filter @playstop/engine build   # once, or after editing packages/engine
pnpm dev:api                            # http://localhost:3001
```

There is no local database. Point `MONGODB_URI` / `MONGODB_DB` / `REDIS_URL` at the shared Atlas
`playstop_dev` database and an Upstash dev database (see `docs/milestone-2-spec.md` section 8 for
how those are provisioned and scoped). Copy `.env.example` to `.env` and fill in the connection
strings.

## Env vars

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3001` | coerced to a number |
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `WEB_ORIGIN` | `http://localhost:5173` | must be a valid URL, bound to CORS |
| `MONGODB_URI` | none, required | `mongodb://` or `mongodb+srv://`. On Windows, prefer the long-form host list over `+srv` if you hit `querySrv ECONNREFUSED`, see `.env.example` |
| `MONGODB_DB` | none, required | `playstop_dev` locally, `playstop` in prod |
| `REDIS_URL` | none, required | `rediss://` for Upstash |
| `HOLD_TTL_SECONDS` | `300` | how long a Redis hold survives |
| `REDIS_COMMAND_TIMEOUT_MS` | `500` | raise to `2000` locally outside Singapore, the default trips on ordinary cross-region latency |
| `APP_ENV` | none, required | `dev` \| `prod`, drives the Redis key prefix, separate from `NODE_ENV` |
| `SENTRY_DSN` | none, optional | unset means `Sentry.init` is a no-op, no network calls |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | |
| `RATE_LIMIT_MAX_REQUESTS` | `30` | per `venueId:ip`, fixed 60s window. Read directly from `process.env`, not part of the Zod schema |

All are parsed with Zod in `src/env.ts` at boot. Invalid or missing values log the field errors
and exit the process immediately rather than starting with bad config.

## Endpoints

All new routes live under `/v1`. `GET /health` stays unversioned, Render's health check and the
external keepalive ping both target it; it also performs a shallow Mongo ping.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | `{ status, uptime }`, `503` if the Mongo ping fails |
| `GET` | `/v1/venues/:venueSlug` | public venue config and active station list |
| `GET` | `/v1/venues/:venueSlug/availability?date=` | per-cell state for one business date |
| `POST` | `/v1/venues/:venueSlug/holds` | acquire a Redis hold over N consecutive cells |
| `POST` | `/v1/venues/:venueSlug/holds/release` | release a hold, idempotent |
| `POST` | `/v1/venues/:venueSlug/bookings` | confirm a booking, requires `Idempotency-Key` |
| `GET` | `/v1/venues/:venueSlug/bookings/:bookingId?code=` | read a booking by confirmation code |
| `POST` | `/v1/venues/:venueSlug/bookings/:bookingId/cancel` | cancel, idempotent, code in the body |

Full request/response shapes and status code tables are in `docs/milestone-2-spec.md` section 6.

## Seed data

```
pnpm --filter @playstop/api seed                  # one Asia/Kolkata venue, 15 stations
pnpm --filter @playstop/api seed -- --with-dst-venue  # plus an America/New_York venue for DST testing
```

Idempotent: upserts on `slug`, running it twice leaves the same venues and stations in place.

## Tests

```
pnpm --filter @playstop/api test
```

Runs `node --test` against the compiled output. Two layers run locally: engine-adjacent unit
tests and low-volume integration tests against the shared Atlas dev database. The concurrency
proof (50-way concurrent confirm bursts) is skipped locally and only runs with
`TEST_PROFILE=ci`, against CI's own Mongo replica set and Redis containers, because Atlas M0's
100 ops/sec throttle makes that suite unreliable against shared infrastructure. See
`docs/ARCHITECTURE.md` for why, and don't set `TEST_PROFILE=ci` against Atlas by hand.

## Module alias

Internal imports use `#*` (e.g. `#env.js`, `#libs/mongo/index.js`, Node's `package.json`
"imports" field, mapped to `./dist/*`), paired with a matching `paths` entry in `tsconfig.json`
so typecheck resolves the same specifiers against `src/`. Not `#/*`: Node's ESM loader rejects
any specifier starting literally with `#/`. `tsc` doesn't rewrite import specifiers on emit, so
runtime resolution has to come from Node itself, not from the compiler. This is also why `dev`
runs `tsc -w` alongside `node --watch dist/main.js`: dev runs from the same compiled output as
production, one resolution mechanism instead of two.

## Deployment

Deploys to Render as a free web service, defined in the root `render.yaml`, region `singapore`.
Build command builds `packages/types` and `packages/engine` first, then this package. Render
pings `/health` to confirm the deploy is live.

Free tier services spin down after 15 minutes idle and take a cold-start hit on the next request.
See `src/app.ts` for the keepalive note and the README deploy section at the repo root for the
mitigation (external ping).
