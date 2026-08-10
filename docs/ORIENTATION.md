# Orientation

Read first. This holds what you cannot get from `ls` or from one file: why things are the way they are,
what is settled, and what has already gone wrong. PlayStop books stations at a physical gaming lounge,
15 of them (PS5, PS3, PS2, racing sim), on a 30-minute grid, variable duration, one group per station.
Party size is checked against station capacity, it is not a scarcity axis. The scarcity is physical: a
double booking means two groups arrive for one console. Concurrency is the product, not a detail of it.

## The paragraph that prevents the worst mistake

A Redis hold is an advisory soft reservation with a TTL. It is **not** proof a cell is free. The
unique partial index `uniq_slot_claim` on `slot_claims` `(venueId, cellStart, stationId)` filtered to
`status: "confirmed"` is the only correctness backstop. A booking writes its `bookings` row, one
`slot_claims` row per cell, and its idempotency finalisation inside one Mongo transaction, so it
takes all its cells or none. When Redis is down the API still books: every client races the index,
one wins, losers get a clean 409 `SLOT_TAKEN`. Availability then reports `degraded: true` and shows
held cells as free, because an optimistic `free` plus a 409 beats showing everything as taken. If you
find yourself adding a lock, a check-then-write, or a "verify the hold more carefully" step, stop:
you are about to write a plausible fix that moves correctness into the layer allowed to fail. Read
`docs/conventions/booking-correctness.md` and `docs/milestone-2-spec.md` sections 4 and 5 first.

## Where to start reading, by task

- **Availability, grid, DST, midnight crossing.** `packages/engine/src/utils/grid/` (hard thinking
  lives there), `utils/availability/`, `apps/api/src/modules/availability/`. Spec sections 2 and 3.
- **Confirm, cancel, the race.** Spec section 4's numbered sequence, then
  `apps/api/src/modules/booking/controller.ts`: `createBooking` is that sequence in one function.
- **Holds.** `apps/api/src/libs/redis/index.ts` (both Lua scripts), then `src/modules/hold/`.
- **Anything crossing the wire.** `packages/engine/src/contracts/<name>/`, defined once and imported
  by both sides. Never redefine a network shape inside an app.
- **Indexes.** `apps/api/src/libs/mongo/indexes.ts`, created at boot; the process exits non-zero if
  that fails, because a running API without `uniq_slot_claim` is a hazard, not a degraded mode.
- **The web client.** `apps/web/src/lib/api.ts` is the only place `fetch` is called. `DESIGN.md` is
  binding. Milestone 3 spec sections 3, 5 and 6.
- **Per-topic rules** live in `docs/conventions/`. Read the relevant one before changing that area.

## Settled. Do not relitigate.

- **No Mongoose.** Zod already validates every shape at the HTTP boundary; Mongoose would be a second
  schema for the same documents, the drift the shared packages exist to prevent.
- **No Docker, no local database.** Dev and prod both run against one Atlas M0 cluster (separate
  database names, a scoped user each) and Upstash Redis in Singapore. Permanent, spec section 8.
- **No Vitest, no Jest.** `node --test` on compiled output; tests in `tests/`, built to `dist-tests/`.
- **No TanStack Table**, no react-hook-form, no client date library, no state manager. Declined in
  writing (milestone 3 spec section 1): none of the four screens is a table, and the form has three
  fields. Table earns its place when the staff schedule view gets built.
- **`packages/types` emits a little runtime JavaScript on purpose**: one keyed const object per
  enum-like union, union derived from it. `engine` cannot own them because it already depends on
  `types`, and `types` still has zero dependencies.
- **`exactOptionalPropertyTypes` stays on.** Two shadcn files carry a one-line fix instead.
- **`Idempotency-Key` is required on confirm**, bound to a hash of the validated body. The
  concurrency proof stays CI-only and stays at full strength.

## Genuinely open

- **No-shows.** Anonymous booking plus free cancellation means speculative booking costs the customer
  nothing. Deposit, phone verification, or accept the loss. The largest risk, and not a technical one.
- **No staff or owner view.** Nobody can free a station for a walk-in. Needs auth, so it is probably
  the highest-value thing after milestone 3.
- **Pricing is flat hourly per station**, and there is no atomic group booking across stations. Peak
  pricing turns `priceBooking` into a sum over cells; group booking is easy mechanically and undecided
  customer-side (one code or two, what cancelling half means).
- **Atlas M0's 100 ops/sec ceiling** is unmeasured against real traffic. A confirm costs 5 to 8
  operations, so roughly 15 concurrent confirms saturates it. `bufferMinutes` is 0; non-zero costs a
  full cell per booking.
- **When auth arrives**, tenant identity must come from the session and the URL slug validated against
  it. Same for the confirmation code, currently both identifier and credential.

## Traps, and what each cost

1. **A non-test filename matching Node's test glob.** As `test-support.ts` the harness was executed as
   a suite, and because it opens Redis at import the run deadlocked instead of failing. Symptom: the
   suite hangs with no failing test named. It is `testing-support.ts`; do not rename it back.
2. **A test that starts a server without `try/finally`.** A failed assertion skipped `server.close()`
   and `closeTestResources()`, the loop never drained, and a failure became an 80 minute hang. Symptom:
   the job burns to its timeout, last output a passing test. Call `teardown(venue, server)` in a
   `finally`; it tolerates setup having thrown.
3. **`tsc` does not clean `dist`.** Stale output kept running after its source moved: a rename once
   looked like it added six tests. Symptom: a count unexpectedly *high*. Every `build` cleans first.
4. **A rate limiter defeated behind a proxy.** Without `app.set("trust proxy", 1)` every request keys
   on Render's edge address, so one venue's limit is shared by all clients. Invisible locally; guarded
   by `apps/api/tests/middleware/rate-limit-proxy.test.ts`.
5. **`RATE_LIMIT_MAX_REQUESTS` must be raised before the dynamic `import()` of the app** in the
   concurrency tests: `env.ts` and the limiter read `process.env` once at import, so the wrong order
   measures the rate limiter instead of the unique index.
6. **A bundle check that could not detect what it claimed to.** Grepping a bundle for `luxon` finds
   nothing either way, since bundling erases specifiers. `check-no-luxon.mjs` greps luxon internals.
7. **`satisfies` guards only one direction.** With a hand-written union plus a separate const object,
   adding a member to the union raised no error, so the Zod contract would silently reject a legal
   value. Fixed by deleting the second declaration. Do not reintroduce that shape.
8. **ioredis with `enableOfflineQueue: false` rejects commands issued before ready**
   (`Stream isn't writeable`); boot awaits `ready`. On Windows `mongodb+srv://` can fail with
   `querySrv ECONNREFUSED` while DNS and TCP are fine: use the long-form connection string.

## How to verify work here

`pnpm typecheck && pnpm lint && pnpm build && pnpm test` is exactly what CI runs. Green locally is
weaker than green in CI: `pnpm test` on a dev machine skips the concurrency proof, gated behind
`TEST_PROFILE=ci`. **Never set that locally** - Atlas M0 throttles at 100 ops/sec and a 50-way burst
fails in a way indistinguishable from the race the suite exists to catch. `tests/testing-support.ts`
throws if `CI` is set without `TEST_PROFILE=ci`, so a green CI run cannot mean the gate was dropped.

Three claims need an experiment rather than a reading, each having failed inspection before:

- **That Mongo supports transactions.** `scripts/assert-replica-set.mjs` proves a commit lands and an
  abort leaves nothing; CI runs it as a gate before the suite.
- **That the availability read is still covered.** `.explain("executionStats")` on the `slot_claims`
  window query: expect `IXSCAN` on `uniq_slot_claim` and `totalDocsExamined: 0`.
- **That a response still matches its contract.** Refinement drift (a tightened regex, a changed
  `min`/`max`) infers to the same type and passes every check, then fails to parse in the browser.
  Only validating whole bodies against their schema closes that gap.

## Current state

Milestones 1 (deploy and CI) and 2 (the booking API) are done and green. Milestone 3, the web client,
sits at roughly step 3 of the ten in milestone 3 spec section 14: dependencies, the `DESIGN.md`
tokens, the shadcn set, and `lib/api.ts` with its tests are in. Not yet written: `router.tsx`, `routes/`,
`lib/query-client.ts`, `lib/grid.ts`, all four screens; `App.tsx` is still the milestone 1 health-check
placeholder. Next is step 4, the query client and the router shell.
