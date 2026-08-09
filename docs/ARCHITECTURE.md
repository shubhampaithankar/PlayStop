# Architecture

## Layout

pnpm workspace monorepo, three packages:

```
apps/web          Vite + React 19 + TypeScript + Tailwind CSS v4, one page
apps/api          Express 5 + TypeScript + Zod, MongoDB + Redis, the booking API
packages/engine   Zod contracts, their inferred types, and pure logic: slot grid, availability,
                  pricing. Anything with runtime behavior lives here.
packages/types    Hand-written TypeScript declarations only: no Zod, no dependencies, emits no
                  JavaScript. Engine's compute vocabulary and the Mongo document shapes.
```

Each has its own `README.md` for specifics. This file is the map between them.

## `apps/api/src` layout

```
app.ts, main.ts       Express app assembly, and the process entry point
env.ts                 Zod env validation, fails fast on boot
errors.ts              DomainError, the one error type routes throw
libs/
  mongo/                connect, typed collection accessors, boot-time createIndexes
  redis/                ioredis client, the two Lua hold scripts, tryRedis wrapper
  sentry/               Sentry.init (no-op with no SENTRY_DSN) and the error handler
middleware/            request-id, request-logger (morgan), rate-limit, venue
                        resolution, error-handler, not-found
modules/
  venue/, availability/, hold/, booking/
                        one folder per resource: route.ts, controller.ts, data.ts
routes/                index.ts mounts /v1/venues/:venueSlug, slug-router.ts
                        wires the four module routers under it
seed.ts                 inserts the demo venue and its stations, idempotent
```

Module convention: `route.ts` wires Express paths to a controller, `controller.ts` validates
with Zod and orchestrates, `data.ts` holds the Mongo queries for that resource. A module never
reaches into another module's `data.ts` directly, it goes through the controller.

Tests live outside `src`, in `apps/api/tests`, mirroring the `src` layout they cover
(`tests/modules/booking/controller.test.ts` tests `src/modules/booking/controller.ts`).
`tests/testing-support.ts` holds the shared test helpers (see "Test file naming" below).
`tsconfig.test.json` compiles `tests/` to `dist-tests/`, kept separate from the runtime
build in `dist/` so a `node --test` run never picks up stale compiled tests.

## Module convention

One folder per thing, each with an `index.ts`. A companion file joins a folder when it has
something to hold, never as an empty stub to complete the pattern. This is why `availability`
and `hold` have no `utils.ts` and `pricing` has no `constants.ts`: there was nothing to put
in them.

```
apps/api/src/
  modules/<domain>/   route.ts -> controller.ts -> data.ts, plus utils.ts where earned
  libs/<vendor>/      third-party wrappers only: mongo, redis, sentry
  middleware/         per-request cross-cutting concerns
  routes/             index.ts mounts each module at its own prefix
                      slug-router.ts holds everything under /venues/:venueSlug

packages/engine/src/
  contracts/<name>/   Zod contracts that cross the network boundary, plus their constants
  utils/<name>/       pure logic: grid, availability, pricing
  constants/<name>/   values shared across the contracts/utils boundary

packages/types/src/
  compute/<name>/     engine vocabulary, epoch milliseconds
  mongo/              on-disk document shapes
  <name>/             standalone unions
```

Where a value lives follows one rule: **declared once, as close to its only consumer as
possible, and lifted only when a second module genuinely needs it.** `CELL_STATES` sits in
`constants/` because the availability logic assigns those states and the contract validates
them. `MS_PER_MINUTE` sits there because grid, availability and pricing all divide by it.
`CONFIRMATION_CODE_PATTERN` stays inside `contracts/booking/` because nothing else uses it.

Enum-like constants are keyed objects consumed with `z.nativeEnum`:

```ts
export const CELL_STATES = { FREE: "free", ... } as const satisfies Record<string, CellState>;
export const cellStateSchema = z.nativeEnum(CELL_STATES);
```

The `satisfies` check against the hand-written union in `packages/types` is what makes drift a
compile error. It replaced a runtime test that asserted the two lists matched, which could only
fail after the fact.
## Dependency direction

The rule is runtime versus compile-time. `packages/engine` holds every Zod schema, the types
inferred from those contracts (`z.infer`), and the pure logic that operates on them; it depends on
`zod`, `luxon`, and `packages/types`. `packages/types` holds only hand-written declarations
(interfaces, type aliases, unions): zero runtime code, zero dependencies, no JS emitted. `apps/web`
and `apps/api` may depend on either package directly. `packages/types` depends on nothing;
`packages/engine` never gets imported by `packages/types`. The direction only ever goes app or
engine toward types, never the reverse.

Any shape that crosses the web-to-api network boundary is a Zod schema, defined once in
`packages/engine/src/contracts/` and imported on both sides, never redefined locally. Structural
shapes that describe engine's own compute functions (`VenueSchedule`, `GridCell`, `StationInput`,
`AvailabilityResult`, and so on) and the Mongo document shapes live in `packages/types`, hand-written since they never touch a schema. Where a wire schema and a compute type share a concept
(a station's `kind`, a cell's `state`), the compute type in `packages/types` is the one
declaration, and the schema in `packages/engine` is built from it with a `satisfies` check so the
two cannot silently drift.

## Module aliases

Three separate mechanisms, chosen per what each context can actually read:

- `apps/web/src/*` → `@/*`. Both a `paths` entry in `tsconfig.json` (so typecheck and editors
  resolve it) and a `resolve.alias` entry in `vite.config.ts` (so the bundle resolves it). Vite
  does not read tsconfig `paths`, the two have to be kept in sync by hand.
- `apps/api/src/*` → `#*` (e.g. `#env.js`, `#libs/mongo/index.js`). A `paths` entry in
  `tsconfig.json` for typecheck, plus Node's native `package.json` `imports` field
  (`"#*": "./dist/*"`) for runtime resolution. `tsc` never rewrites import specifiers on emit, so
  without the `imports` field a `#`-prefixed import would typecheck and then throw at runtime. The
  pattern is `#*`, not `#/*`: Node's ESM loader rejects any specifier starting literally with `#/`
  (`ERR_INVALID_MODULE_SPECIFIER`), verified directly, not assumed. Because runtime resolution
  points at `dist/`, `apps/api`'s `dev` script also runs from `dist/` (`tsc -w` alongside
  `node --watch dist/main.js`) rather than running the TypeScript source directly, one resolution
  path instead of two.
- `@playstop/types` and `@playstop/engine` need no path alias at all, pnpm workspace linking
  already resolves them by package name.

## Deployment topology

- `apps/web` deploys to Cloudflare Pages (dashboard-configured, see root `README.md`).
- `apps/api` deploys to Render as a free web service (`render.yaml` at the repo root).
- Pages talks to Render over HTTPS via `VITE_API_URL`. Render's `WEB_ORIGIN` env var is set to
  the Pages URL and used for CORS.
- MongoDB Atlas M0 and Upstash Redis, both in the Singapore region alongside Render, back both
  production and local development. There is no local database and no Docker. Dev and prod are
  separate database names on the same Atlas cluster (`playstop_dev` and `playstop`), with a
  scoped Atlas user per database so dev credentials cannot reach the prod database.
- Atlas M0 throttles at 100 operations/second, so the concurrency test suite cannot run against
  it. That suite runs in CI only, against GitHub Actions service containers (a real Mongo replica
  set and a real Redis). See `docs/milestone-2-spec.md` section 9.
- Render free spins down after 15 minutes idle. An external keepalive ping to `/health` is the
  mitigation, see the root `README.md`. `/health` also pings Mongo (shallow), so the same ping
  keeps the Atlas cluster from auto-pausing after 30 idle days.
- Sentry captures unhandled 5xx errors and errors with no status code. Expected outcomes (404,
  409, 422, 429) are filtered out in `libs/sentry/index.ts`, they are normal traffic, not bugs.
  Off entirely with no `SENTRY_DSN` set (local dev, CI).

## Package manager

The workspace uses pnpm's `hoisted` node linker (`node-linker=hoisted` in `.npmrc`) so all
installed packages live under one root `node_modules` instead of duplicated per package.
Tradeoff: this gives up pnpm's default strict isolation, a package can end up resolving a
dependency it never declared in its own `package.json`.

## Things that cost real debugging time

Worth knowing before touching this code again.

- **Test files must not match Node's test glob unless they are tests.** `node --test`'s default
  glob picks up any file named `test-*.js`, `*-test.js`, `*_test.js`, or `*.test.js`. The shared
  test harness is `testing-support.ts`, not `test-support.ts`, for exactly this reason: named
  `test-support.ts` it was picked up and executed as a suite by the runner, and because it opens
  a Redis connection as an import-time side effect, the run deadlocked instead of failing loudly.
  Moving it into `tests/` was not permission to rename it, the same glob risk applies there too.
- **Every test that starts a server must release it in `try/finally`.** Otherwise a failed
  assertion mid-test skips `server.close()` and `closeTestResources()`, the Mongo pool and the
  ioredis socket stay open, the event loop never drains, and a test *failure* becomes a silent
  *hang*. This cost an 80 minute CI run before the pattern was applied everywhere a server starts.
- **The concurrency suite is gated behind `TEST_PROFILE=ci`.** Atlas M0 throttles at 100
  operations/second. A 50-way concurrent burst against it produces failures indistinguishable
  from the race conditions the suite exists to catch, so it only runs against CI's real replica
  set and Redis service containers, never against the shared Atlas dev database.
- **The concurrency tests raise `RATE_LIMIT_MAX_REQUESTS` before importing the app.** The real
  30/minute limit would reject requests 31 through 50 of a 50-way burst on one venue, so the test
  would measure the rate limiter instead of the unique index. `env.ts` and the rate limiter both
  read `process.env` once at import time, so the override has to land before the dynamic
  `import()` of the app modules, not just before the fetch calls.
- **`build` cleans `dist/` first.** `tsc` does not delete stale output on its own, so a source
  file that moved or was deleted leaves its old compiled `.js` (and any `.test.js` next to it)
  behind in `dist/`, and `node --test dist/` keeps running it.
- **Local dev on Windows may need Atlas's non-SRV connection string.** Node's DNS resolver can
  fall back to `127.0.0.1` when it cannot parse Windows DNS config, which breaks
  `mongodb+srv://` with `querySrv ECONNREFUSED` while `dns.lookup` and outbound TCP both work
  fine. The long-form `mongodb://host1,host2,host3/?replicaSet=...` string avoids SRV entirely.
  Render is unaffected, it uses SRV. See `apps/api/.env.example`.
- **ioredis rejects commands issued before the client is ready.** With `enableOfflineQueue: false`
  (required, see `docs/milestone-2-spec.md` section 4), a command issued before the socket reaches
  the `ready` state fails with `Stream isn't writeable` instead of queueing. Boot must await the
  `ready` event, not assume the constructor returns a usable client.

## Current state vs planned

**Done (milestone 1):** deployment and CI scaffold. Build, typecheck, lint, deploy, CORS, env
validation, all wired and green.

**Done (milestone 2):** the booking flow, backend only. Venue and station lookup, availability
query, Redis soft holds, idempotent confirm, cancel. Variable-duration bookings on a 30-minute
grid, held atomically through a `slot_claims` collection and a Mongo transaction. MongoDB Atlas
and Upstash Redis are live infrastructure, not planned work. The full specification is
`docs/milestone-2-spec.md`, and it remains the source of truth for the data model, the
concurrency design, and the test strategy.

**Planned (milestone 3), not yet present on purpose:** shadcn/ui, TanStack Router/Query/Table,
the booking UI, auth, accounts. None of this is an oversight. Adding any of it before milestone 3
starts is scope creep.
