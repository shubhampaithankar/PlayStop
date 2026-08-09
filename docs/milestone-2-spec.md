# PlayStop Milestone 2 Backend Specification

Revision 2. The domain changed from a coin-op arcade to a gaming lounge, and
four design decisions were taken after revision 1 was written: a 30-minute
grid, variable-duration bookings backed by a `slot_claims` collection and
Mongo transactions, opening hours that may cross midnight, and a cancel
endpoint. The infrastructure decision also changed: there is no local
database, dev and prod both run against MongoDB Atlas and Upstash Redis in
Singapore. Every section below reflects those decisions. Where revision 1
said "zero transactions" or "one booking equals one slot", that text has been
rewritten rather than left standing.

## The domain, stated once

PlayStop is a **gaming lounge**, closer to an internet cafe than an arcade.
The bookable resource is a **station**: a console or a PC, plus a screen and
seats. The seeded venue has 7 x PS5, 3 x PS3, 2 x PS2, and 3 racing sim PCs,
15 stations total. The games are GTA, FIFA, WWE 2K, NBA 2K, mostly couch
multiplayer, so a station seats 2 to 4 players.

Stations are rented by time. **A station is booked exclusively by one group.**
Two unrelated groups never share a station. Party size is therefore metadata
on the booking, validated against the station's controller and seat capacity,
and it is **not a scarcity axis**. There is no seat dimension in any index.
The scarce thing is a (station, time cell) pair and nothing else.

---

## 0a. Step 0 results, run 2026-08-06 against the real cluster

The step 0 gate has been run against the provisioned Atlas M0 and Upstash
instances. All 14 checks passed. Findings that supersede the table below:

- **Atlas M0 multi-document transactions are CONFIRMED working.** This was
  revision 2's single largest open risk. Verified: `setName=atlas-<redacted>-shard-0`
  (a real replica set), a three-collection transaction committed, and a
  transaction losing a duplicate-key race on its MIDDLE cell rolled back with
  zero rows persisted. The `slot_claims` design holds on real infrastructure.
- **Atlas M0 runs MongoDB 8.0.28**, not 7.x. CI's service container is pinned
  to 8.0 to match. Do not let those drift.
- **Section 9's test paths are stale.** Tests moved out of `src` into a sibling `tests/`
  directory in both packages, compiled by a separate `tsconfig.test.json` to `dist-tests/`
  (kept out of the runtime `dist/`). Layer 1 is now `packages/engine/tests/*.test.ts`, layer 2
  is `apps/api/tests/**/*.test.ts`, mirroring the `src` layout each file covers.
- The duplicate key inside a transaction surfaces as `MongoBulkWriteError` with
  `code === 11000`, as specified.
- **Upstash requires awaiting the ready state before any command.** With
  `enableOfflineQueue: false` (which section 4 requires, correctly), ioredis
  rejects commands issued before the socket is ready with `Stream isn't
  writeable`. `apps/api/src/redis.ts` must await the `ready` event at boot
  rather than assuming the constructor returns a usable client. Verified:
  `SET NX PX`, `EVAL` compare-and-delete, `SCAN MATCH`, and `MGET` all work.
- **Local dev on Windows may need the non-SRV connection string.** Node's
  c-ares resolver can fall back to `127.0.0.1` when it cannot parse Windows DNS
  config (virtual adapters advertising `fec0::` servers are one trigger), which
  breaks `mongodb+srv://` with `querySrv ECONNREFUSED` while `dns.lookup` and
  outbound TCP both work fine. The long-form `mongodb://host1,host2,host3/?replicaSet=`
  string avoids SRV entirely. Render is unaffected, use SRV there.

> **Superseded in places.** This is the milestone 2 design record, kept as written.
> After it was finished, the shared packages were re-split: `@playstop/engine` now
> holds every Zod schema plus the pure logic, and `@playstop/types` holds only
> hand-written declarations and emits no JavaScript. Build commands and package
> paths below reflect the older layout. `docs/ARCHITECTURE.md` is the current map.

## 0b. Measured latency, 2026-08-06, dev machine (India) to Singapore

| Operation | p50 | p95 | p99 |
|---|---|---|---|
| Redis PING | 92 | 101 | 357 |
| Redis SET NX PX | 94 | 96 | 343 |
| Redis GET | 92 | 96 | 101 |
| Redis MGET x6 | 92 | 94 | 94 |
| Redis SCAN MATCH | 92 | 95 | 108 |
| Mongo ping | 91 | 93 | 94 |
| Mongo findOne | 91 | 93 | 95 |

All figures in milliseconds. Consequences:

- **`commandTimeout` must be configurable, not a constant.** Section 4's value of
  500 ms would trip on the measured 357 ms p99 and drop the API into degraded
  mode during ordinary jitter. Use `REDIS_COMMAND_TIMEOUT_MS`, defaulting to 500
  for production, set to 2000 in a local `.env`.
- **These numbers are development-only and must not be used to size production.**
  The ~90 ms floor is the dev machine in India reaching Singapore. Production is
  Render Singapore to Upstash and Atlas Singapore, same region, so expect single
  digit milliseconds. Re-measure from Render before tuning anything for prod.
- A confirm doing roughly 5 Mongo plus 2 Redis round trips costs about 650 ms of
  pure network from the dev machine. Manual testing will feel slow, and the
  low-volume integration tests running against Atlas will take about a second
  each. That is expected, not a bug, and it is a dev-only cost.

## 0. What I verified vs assumed

### Verified

| Claim | Source | Result |
|---|---|---|
| Zod resolved version | `pnpm-lock.yaml` | `zod@3.25.76`. Zod 3 API (`.flatten()`, `z.coerce`, `.url()`) as already used in `apps/api/src/env.ts`. Do not use Zod 4 syntax. |
| Express 5 auto-forwards rejected promises to error middleware | `/expressjs/express/v5.2.0`, including the repo tests `test/app.route.js` and `test/app.router.js` | Confirmed. No `express-async-handler`, no try/catch wrapper. Error middleware must have exactly 4 params and be registered last. |
| Mongo duplicate key surfaces as `MongoServerError` with code `11000` / `E11000` | `/mongodb/node-mongodb-native` README and `src/operations/update.ts` | Confirmed. Driver docs explicitly recommend `error instanceof MongoServerError` over message parsing. |
| `insertMany` failures surface as `MongoBulkWriteError` | `/mongodb/node-mongodb-native` `CHANGES_4.0.0.md`, `BulkWriteResult.getWriteErrors()`, CRUD spec tests | Confirmed. `BulkWriteError` was renamed `MongoBulkWriteError` in driver 4. Ordered bulk writes stop at the first write error. Individual errors are reachable via `writeErrors`. |
| Partial unique indexes and TTL indexes via `createIndex` | `/mongodb/node-mongodb-native` index_management tests | Confirmed (`partialFilterExpression`, `expireAfterSeconds`). |
| `ClientSession.withTransaction` exists, retries automatically, and takes `timeoutMS` | `/mongodb/node-mongodb-native` `docs/7.5/classes/ClientSession.html` and `src/sessions.ts` | Confirmed. Signature is `withTransaction(fn, options?: TransactionOptions & { timeoutMS?: number })`. The driver retries the whole callback on `TransientTransactionError` and retries the commit on `UnknownTransactionCommitResult`. Documented constraints: the callback may run more than once, operations inside it must not run in parallel, and errors must be rethrown. |
| The driver's transaction retry loop is bounded at 120 seconds by default and that bound is not configurable except through `timeoutMS` | `mongodb/specifications`, `transactions-convenient-api.md` | Confirmed. "If `timeoutMS` is unset for a `withTransaction` call, drivers MUST enforce a 120-second timeout to limit retry behavior and safeguard applications from long-running (or infinite) retry loops." This is why section 4 sets `timeoutMS` explicitly. |
| Duplicate key (11000) is **not** a `TransientTransactionError`, so `withTransaction` does not retry it | `/mongodb/node-mongodb-native` `src/sessions.ts` retry loop, plus MongoDB error-label docs | Confirmed. Only `TransientTransactionError` restarts the callback and only `UnknownTransactionCommitResult` retries the commit. 11000 carries neither label, so it aborts the transaction and propagates to the caller. |
| A concurrent uncommitted transaction holding the same unique key produces `WriteConflict` (112), which **is** labelled `TransientTransactionError` | MongoDB write-conflict docs and the driver retry loop above | Confirmed. This is the mechanism that makes the loser of a race retry once and then receive a definitive 11000 after the winner commits. Section 4 depends on it. |
| Client-side operation timeout (`timeoutMS`) and `MongoOperationTimeoutError` exist in the current driver | `/mongodb/node-mongodb-native` `docs/7.5/classes/MongoOperationTimeoutError.html`, `etc/notes/errors.md` | Confirmed. Server-side `MaxTimeExpired` is converted to `MongoOperationTimeoutError` when `timeoutMS` is enabled. |
| Atlas M0 is a 3-node replica set | MongoDB Atlas docs, `reference/free-shared-limitations` | Confirmed. Replication factor fixed at 3, not configurable. No sharding. Replica set is the documented prerequisite for transactions. |
| Atlas M0 throttles at 100 operations per second | MongoDB Atlas docs, `reference/free-shared-limitations` | Confirmed. Exceeding it triggers network throttling with a 1-second cooldown, and queued operations may wait longer than 1 second if the queue exceeds the rate limit. This is the single most important constraint in section 9. |
| Atlas M0 caps at 500 collections total across all databases, 100 databases, 500 connections, 0.5 GB storage, 10 GB in and 10 GB out per rolling 7 days | MongoDB Atlas docs, `reference/free-shared-limitations` | Confirmed. Also: 32 MB in-memory sort limit, `allowDiskUse` ignored, aggregation capped at 50 stages, `$currentOp` / `$planCacheStats` / `$listSessions` unsupported, no reads on `local`, no access to `admin`. |
| Atlas M0 auto-pauses after 30 days of inactivity with zero connections | MongoDB Atlas docs, `reference/free-shared-limitations` | Confirmed, and it can be resumed manually. One secondary source claimed 60 days; the official limitations page says 30, and that is the number used here. |
| Upstash Redis free tier is 500,000 commands per month, not 10,000 per day | Upstash pricing page, plus the 2025-03-12 pricing change | Confirmed. The old 10,000/day cap was replaced by a 500K/month allowance on 12 March 2025. **Revision 1's figure was stale and every budget calculation derived from it was wrong.** Free tier also gives 256 MB max data size, 10 GB bandwidth, 10 MB max request size, and up to 10 free databases per account. |
| Upstash supports `EVAL` and `EVALSHA` | `/upstash/docs` `redis/sdks/ts/commands/scripts/eval.mdx`, `evalsha.mdx` | Confirmed, over REST and over TCP. Both multi-cell hold scripts in section 4 depend on this. |
| Upstash supports native TCP (`rediss://`) as well as REST, and documents ioredis as a client | `/upstash/docs` `redis/overall/compatibility.mdx`, `redis/howto/connect-client.mdx` | Confirmed. |
| Upstash does NOT support blocking commands, `WATCH`/`UNWATCH`/`DISCARD`, or Cluster | `/upstash/docs` `redis/features/restapi.mdx` | Confirmed. The design uses none of these. Section 8 has the full audit. |
| Render free web services spin down after 15 minutes idle, and Singapore is an available region | Render docs `render.com/docs/free`, Render pricing | Confirmed. Spin-up on the next request takes about one minute. 750 free instance hours per workspace per month. The repo `README.md` already documents the keepalive ping mitigation. |
| Luxon spring-forward behavior | `/moment/luxon` `docs/zones.md` | A nonexistent local time is advanced by one hour. Deterministic and documented: `DateTime.local(2017, 3, 12, 2, 30).toString()` is `2017-03-12T03:30:00.000-04:00`. |
| Luxon fall-back behavior is explicitly undefined, but `getPossibleOffsets()` makes it decidable | `/moment/luxon` `docs/zones.md` and `src/datetime.js` | Confirmed. The docs state the ambiguous case "should not be relied upon". `getPossibleOffsets()` returns both candidate DateTimes when the local time is ambiguous and `[this]` otherwise. This single API is why Luxon is chosen. |
| Luxon `plus({ days: 1 })` is calendar arithmetic and holds the local hour across a DST change, unlike `plus({ hours: 24 })` | `/moment/luxon` `docs/zones.md` | Confirmed: `start.plus({ days: 1 }).hour` stays the same while `start.plus({ hours: 24 }).hour` shifts by one. **This is exactly the behavior the midnight-crossing rule in section 2 needs**, and getting it backwards is the obvious way to break a lounge that closes at 02:00. |
| `supercharge/mongodb-github-action` supports replica sets | Action README and `start-mongodb.sh` | Confirmed via the `mongodb-replica-set` input. Current version 1.12.x. It runs as a workflow **step**, not as a service container. Two caveats found: the README never mentions transactions, and it documents no way to wait for the replica set to become ready. Section 9 handles both. |
| Atlas built-in `readWrite` can be scoped to a single named database | MongoDB Atlas docs, `security-add-mongodb-roles` | Confirmed. Note the trap: the Atlas quickstart flow grants `readWriteAnyDatabase` by default, which is exactly what the dev/prod split must not use. Section 8 spells out the correct configuration. |

### Assumed, flagged, verify at implementation time

1. **`MongoServerError` exposes `keyPattern` / `keyValue` on duplicate-key errors.** The docs confirm `code` but not those fields. The design does not depend on them for control flow. They are read only to enrich an error message, behind a presence check. Index-name matching on the error message is the disambiguation mechanism, and that is documented.
2. **Multi-document transactions work on Atlas M0.** Sources conflict, and this is the highest-stakes unverified claim in the document. MongoDB staff state on the community forum that "you can definitely use transactions on an M0 free tier cluster", and M0 is a 3-node replica set, which is the documented prerequisite. One automated summary of the Atlas limitations page reported multi-document transactions as unsupported on M0. I could not reproduce that line in the page text and believe it is a mis-parse of the Serverless or Flex limitations, but I cannot rule it out by reading. **Step 0 of section 10 is a 20-line smoke test: open a session, write one document into `bookings` and one into `slot_claims` inside a transaction, commit, assert both landed, then assert an aborted transaction leaves neither.** If that fails, the multi-cell design collapses and the fallback in section 4 applies. Do not start step 1 before running it.
3. **The 500K commands/month Upstash allowance is per database, not per account.** The pricing page states "500K commands" alongside "up to 10 databases for free" without saying which the quota attaches to. The budget in section 8 holds either way with a wide margin, so no decision turns on it.
4. **ioredis maintenance posture.** Redis Inc. has been steering users toward `node-redis`. Not verified. Chosen anyway for the reasons in section 4. The swap surface is one file (`apps/api/src/redis.ts`).
5. **`timeoutMS` on `withTransaction` is honored by the driver version actually installed.** Verified against the driver's own 7.x docs. Pin `mongodb@^6.20` or newer. If the pinned version predates client-side operation timeout, the fallback is `maxCommitTimeMS` plus a hand-rolled deadline, noted in section 4.
6. **Atlas M0 in Singapore (AWS `ap-southeast-1`) is available for new free clusters.** Region availability for M0 shifts over time. Confirm in the Atlas UI at provisioning. If Singapore is unavailable for M0, take the nearest available region and record the change here.
7. **Upstash region coverage for Singapore on the free tier.** The pricing page did not enumerate regions. Confirm at provisioning; if Singapore is unavailable, the nearest region is acceptable and only adds latency.

---

## 1. Data model

Database: two databases on one Atlas M0 cluster, `playstop` for production and `playstop_dev` for development and low-volume integration tests. Section 8 covers the credential split. Driver: **`mongodb` native driver, not Mongoose.**

Justification, unchanged from revision 1: Zod schemas in `packages/types` already validate every shape at the HTTP boundary, and the repo convention (`packages/types/README.md`) says shapes are defined once. Mongoose would be a second, parallel schema definition of the same documents, which is the drift the types package exists to prevent. The operations needed are `connect`, `createIndex`, `insertOne`, `insertMany`, `find`, `findOne`, `updateOne`, `updateMany`, `countDocuments`, `startSession`, `withTransaction`. Nothing else. Tradeoff accepted: no `populate`, no middleware hooks, no automatic casting, and index creation is hand-written at boot.

The transaction requirement strengthens this choice rather than weakening it. Mongoose puts a layer between the code and `withTransaction`'s documented retry semantics, and those semantics are load-bearing here.

Every document carries `venueId: ObjectId`. Every query filter includes it. No exceptions.

### `venues`

```
_id             ObjectId
slug            string      // URL-safe, e.g. "playstop-indiranagar"
name            string
timezone        string      // IANA. Validated against Intl.supportedValuesOf("timeZone") at seed time.
gridMinutes     number      // 30. The bookable cell size. Integer > 0, must divide 60.
bufferMinutes   number      // changeover between groups. Integer >= 0, default 0. See section 3.
currency        string      // ISO 4217, "INR"
openingHours    { [weekday: "0".."6"]: { open: "HH:MM", close: "HH:MM" } | null }
                            // local wall-clock, keyed by the weekday the session OPENS on.
                            // 0 = Sunday (Luxon weekday % 7, see section 2).
                            // close <= open means the session runs past local midnight.
                            // null = closed that weekday.
blackoutDates   string[]    // ["2026-12-25"], local business dates, venue closed entirely
leadTimeMinutes number      // cannot book a cell starting sooner than now + this
maxAdvanceDays  number      // cannot book further ahead than this many business days
createdAt       Date
```

`gridMinutes` replaces revision 1's `slotMinutes`. The rename is deliberate. Revision 1's `slotMinutes` meant "the length of a booking", and a booking no longer has a fixed length. `gridMinutes` means "the quantum a booking is measured in", a different concept that happened to have the same value.

`gridMinutes` must divide 60. Non-divisors produce cells that do not align to the hour, which makes hourly pricing lossy and every local label awkward to read. Validated at seed time.

`venueId` is `_id` here. The tenant key on this collection is the document identity itself.

### `stations`

One physical station: a console or PC, its screen, and its seats.

```
_id                ObjectId
venueId            ObjectId    // TENANT KEY
slug               string      // "ps5-3", "sim-1"
name               string      // "PS5 #3", "Sim Rig 1"
kind               "ps5" | "ps3" | "ps2" | "racing-sim"
status             "active" | "retired"
capacity           number      // controllers and seats. 1..8. The party-size ceiling.
hourlyRateMinor    number      // integer minor units of venue.currency. 15000 = Rs 150.00 per hour.
minSlots           number      // minimum cells per booking, integer >= 1
maxSlots           number      // maximum cells per booking, integer >= minSlots
maintenanceWindows [{ startsAt: Date, endsAt: Date }]   // UTC instants, half-open [start, end)
createdAt          Date
```

**Station attributes live on the station document. There is no `stationTypes` collection.** Fifteen stations across four kinds does not justify a join, a second collection against Atlas M0's 500-collection cap, and a second read on every availability request. The "types" concept lives in the seed script, where it costs nothing. Ceiling named: if an operator ever needs to reprice every PS5 at once, that is an `updateMany` filtered on `kind` rather than a single-document edit, still one line. Upgrade path if the station count reaches the hundreds and rates change often: extract a `station_types` collection and denormalize the rate onto the station at write time, keeping the read path single-collection either way.

`kind` is a first-class field rather than something inferred from the slug because availability clients want to filter by it, and because `updateMany({ kind })` is the repricing path above.

Price is derived, never stored on the station in computed form:

```
totalMinor = hourlyRateMinor * slotCount * gridMinutes / 60
```

Seed-time validation asserts `(hourlyRateMinor * gridMinutes) % 60 === 0` for every station, so every cell price is an exact integer of minor units and no rounding rule is needed anywhere. With `gridMinutes: 30` that reduces to "the hourly rate must be even in minor units", which is trivially satisfiable and removes a whole class of money bug. **Money is integer minor units end to end. No floats, no decimals, no `toFixed` in a price path.**

Maintenance windows are stored as absolute UTC instants, not local recurrences. Maintenance is a real-world event scheduled by a human at a specific moment, and recurrence rules are not in scope. Ceiling: no recurring maintenance. Upgrade path: add an `rrule` field and expand it into windows before calling `computeAvailability`, which is a pure-function change.

### `bookings`

```
_id               ObjectId
venueId           ObjectId    // TENANT KEY
stationId         ObjectId
startsAt          Date        // UTC instant, the first play cell's start
endsAt            Date        // startsAt + slotCount * gridMinutes. Exclusive. Play only, no buffer.
slotCount         number      // number of PLAY cells, minSlots..maxSlots
bufferSlotCount   number      // number of trailing BUFFER cells, ceil(bufferMinutes / gridMinutes)
partySize         number      // 1..station.capacity. Metadata, not a scarcity axis.
status            "confirmed" | "cancelled"
confirmationCode  string      // 10 chars, crypto.randomBytes -> Crockford base32, no ambiguous glyphs
totalMinor        number      // integer minor units, computed server-side at confirm
currency          string      // copied from the venue at confirm, so a later currency change cannot rewrite history
player            { name: string, email?: string, phone?: string }
idempotencyKey    string      // the client key that created it, for audit
createdAt         Date
cancelledAt       Date | null
```

**`bookings` is no longer where slot identity lives.** Revision 1 made `(venueId, stationId, startsAt)` unique on this collection and called it the correctness backstop. With a booking spanning 1..N cells that index is not a backstop at all: a 3-cell booking starting at 14:00 and a 1-cell booking starting at 14:30 have different `startsAt` values, both insert cleanly, and the station is double-booked. The index is removed and replaced by the one on `slot_claims`.

`totalMinor` and `currency` are denormalized onto the booking deliberately. A booking is a commercial record. Recomputing its price later from the station's current rate would silently rewrite what a customer was quoted.

`endsAt` covers play cells only. The buffer is not part of what the customer bought, so it does not belong in the customer-visible end time, but it does occupy cells. Section 3 explains why.

### `slot_claims`

One document per occupied 30-minute cell. This is the correctness surface.

```
_id         ObjectId
venueId     ObjectId    // TENANT KEY
stationId   ObjectId
bookingId   ObjectId
cellStart   Date        // UTC instant, aligned to the venue grid. CELL IDENTITY.
kind        "play" | "buffer"
status      "confirmed" | "cancelled"
createdAt   Date
```

**Cell identity is `(venueId, stationId, cellStart)` where `cellStart` is a BSON `Date`, a UTC instant to millisecond precision.** Not a local string, not a date-plus-time string, not an ISO string. The grid generator always produces instants stepped by elapsed milliseconds from a single resolved opening instant, so two clients asking for "the 14:30 cell" produce bit-identical `Date` values. That property is what makes the unique index work, and the whole design rests on it.

`kind` distinguishes the cells a group plays from the changeover cells that follow. Both occupy the index. Section 3 explains why the buffer has to occupy cells rather than being folded into a stride, and why revision 1's claim about the buffer no longer holds.

Claims are never written outside a transaction and never written without their booking. A `slot_claims` document with no matching `bookings` document is a bug, not a state.

### `idempotency`

```
_id          string     // `${venueId}:${idempotencyKey}` -- a STRING, not an object
venueId      ObjectId   // TENANT KEY, duplicated out of _id for query clarity
key          string
requestHash  string     // sha256 hex of canonical JSON of the validated request body
state        "in_flight" | "completed" | "failed"
statusCode   number?    // set when terminal
response     object?    // the exact JSON body that was returned, replayed verbatim
bookingId    ObjectId?
createdAt    Date
expiresAt    Date       // createdAt + 24h
```

`_id` is a concatenated string rather than a compound object because Mongo equality-matches object `_id` values by exact field order, which is a footgun. A string has no field order. Using `_id` gives uniqueness for free, with no extra index and no extra write.

Separate collection, not a subdocument on `bookings`, for two reasons that both still hold: it must be written *before* the booking exists, and keeping it separate keeps each collection's set of unique indexes small enough to disambiguate an 11000 by index name.

One change from revision 1: **the successful finalization of an idempotency record now happens inside the booking transaction.** Section 5 explains the crash window that closes.

### Collection count

Four collections per database, eight across `playstop` and `playstop_dev`. Atlas M0 caps at 500 collections in total. This design uses 1.6% of that, and section 9 explains why the test strategy must not create collections per test run.

### Indexes, every one, with justification

| Collection | Index | Options | Why it exists, and which query |
|---|---|---|---|
| `venues` | `{ slug: 1 }` | `unique: true` | Every request resolves the tenant by URL slug. Unique prevents two venues claiming one slug. |
| `stations` | `{ venueId: 1, status: 1 }` | | Availability fetches active stations for one venue: `find({ venueId, status: "active" })`. Leading `venueId` puts the tenant prefix on the index itself. |
| `stations` | `{ venueId: 1, slug: 1 }` | `unique: true` | Human-readable station addressing, and prevents duplicate station slugs within a venue. Tenant-scoped, so two venues may both have `ps5-3`. |
| `slot_claims` | **`{ venueId: 1, cellStart: 1, stationId: 1 }`** | **`unique: true`, `partialFilterExpression: { status: "confirmed" }`**, name `uniq_slot_claim` | **The correctness backstop, and the only index this collection needs.** Derivation below. |
| `bookings` | `{ venueId: 1, confirmationCode: 1 }` | `unique: true`, name `uniq_booking_code` | Serves `GET /bookings/:id?code=`, the cancel authorization, and guarantees the generated code is collision-free within a tenant. Uniqueness matters because the code is the only thing authorizing an anonymous read or cancel. |
| `idempotency` | `_id` (implicit) | implicit unique | The idempotency claim itself. Insert-wins semantics with zero extra index writes. |
| `idempotency` | `{ expiresAt: 1 }` | `expireAfterSeconds: 0` | Retention. Mongo deletes documents once `expiresAt` is in the past. The background TTL monitor runs about every 60s, so deletion is approximate, which is fine for a retention policy. |

Six indexes, down from seven in revision 1, despite the design getting strictly more capable. That comes from one derivation worth spelling out.

#### Why `slot_claims` needs exactly one index, and why the key order is what it is

Three separate jobs need serving on this collection:

1. **Enforce that no two confirmed claims share a (venue, station, cell).** This is the invariant the milestone exists to guarantee.
2. **Read every occupied cell for one venue across a time window**, to build an availability response. Filter: `venueId` equality, `cellStart` range, `status: "confirmed"`. Projection: `stationId` and `cellStart`.
3. **Find the claims belonging to one booking**, to cancel them.

A compound unique index enforces uniqueness of the whole tuple **regardless of key order**. `{venueId, stationId, cellStart}` and `{venueId, cellStart, stationId}` constrain exactly the same thing. Key order only affects which queries the index can serve, so the order is free to pick, and only one order serves job 2.

Order it `{ venueId: 1, cellStart: 1, stationId: 1 }`:

- **Job 1:** unique on the tuple, satisfied by construction.
- **Job 2:** `venueId` equality followed by a `cellStart` range is a clean index prefix, so this is an `IXSCAN`, not a `COLLSCAN`. Better than that, every field the query needs (`venueId`, `cellStart`, `stationId`) is an index key, so with `projection: { stationId: 1, cellStart: 1, _id: 0 }` it becomes a **covered query**. Mongo answers it from the index alone and never fetches a document. This is the hottest read in the system, run once per availability request, and it costs zero document reads. On a tier throttled at 100 ops/sec, that matters.
- **Job 3:** cancel filters `{ venueId, stationId, cellStart: { $gte: booking.startsAt, $lt: bufferEnd }, bookingId, status: "confirmed" }`. `venueId` equality plus `cellStart` range plus `stationId` equality is served by the same index, with `bookingId` as a residual filter over at most `maxSlots + bufferSlotCount` documents.

Order it the other way, `{venueId, stationId, cellStart}`, and job 2 can only bound on `venueId`, so an availability request scans every claim the venue has ever made. That is the difference between a covered scan of one evening and a growing scan of all history.

`partialFilterExpression: { status: "confirmed" }` does three things at once:

- It is what makes cancellation free a cell. A cancelled claim leaves the index, so the cell stops being unique-constrained and stops appearing in availability. Section 4's cancel path depends on this and on nothing else.
- It keeps the index to live claims only, so the index size tracks future bookings rather than all history.
- It means `status` in the query filter is a correctness assertion rather than a selectivity mechanism, because the partial filter already excluded cancelled rows.

Adding `partialFilterExpression` later would mean dropping and recreating a unique index on a live collection. One line now.

**`EXPLAIN ANALYZE` requirement:** run `.explain("executionStats")` on the availability query before shipping. Expect `IXSCAN` on `uniq_slot_claim`, `totalDocsExamined: 0` (covered), and `totalKeysExamined` close to `nReturned`. Record the numbers. A non-zero `totalDocsExamined` means the projection is wrong and the covered read has silently become a fetch.

Index creation runs at API boot in `apps/api/src/db.ts` via `createIndexes`, idempotent, before the HTTP listener starts. If index creation fails, the process exits non-zero. A running API without `uniq_slot_claim` is a correctness hazard, not a degraded mode.

---

## 2. Time, timezone, and sessions that cross midnight

### What is stored

- **Every instant in Mongo is a UTC BSON `Date`.** `bookings.startsAt`, `bookings.endsAt`, `slot_claims.cellStart`, `stations.maintenanceWindows[]`, all `createdAt` / `expiresAt` / `cancelledAt`.
- **Wall-clock is stored only as venue configuration:** `venues.timezone` (IANA name), `venues.openingHours` (`"HH:MM"` strings per weekday), `venues.blackoutDates` (`"YYYY-MM-DD"` local business dates).
- **No booking and no claim ever stores a local time.** The conversion happens once, in the engine, when generating the grid.

This split is the whole trick. Opening hours are a human intention expressed in wall-clock ("we open at 2pm and close at 2am") and must follow the clock through DST. A booked cell is a physical moment and must not move. Storing each in its natural representation means neither has to be corrected later.

### Library

**Luxon.** Add `luxon` and `@types/luxon` to `packages/engine`, where it becomes a transitive dependency of `apps/api`.

Why a library at all: we need the *inverse* of formatting, converting a local wall-clock time in an arbitrary IANA zone into a UTC instant. `Intl.DateTimeFormat` formats an instant into a zone and has no supported inverse. Hand-rolling one means binary-searching offsets, which is exactly the kind of subtle code that breaks at 2am on the last Sunday in October.

Why Luxon over `date-fns-tz`: `DateTime#getPossibleOffsets()`. Luxon's own documentation states that its behavior for ambiguous fall-back times is undefined and must not be relied on. `getPossibleOffsets()` returns both candidate instants explicitly, which lets us write a deterministic disambiguation rule instead of depending on undocumented behavior. That is the one API that makes the fall-back rule below specifiable at all.

Why not `Temporal`: not stable in Node 20 or 22. Not available.

Luxon weekday note: `DateTime.weekday` is 1 (Monday) through 7 (Sunday). The `openingHours` map is keyed 0 (Sunday) through 6 (Saturday). The engine converts with `luxonWeekday % 7`. Write a test asserting all seven mappings. Off-by-one on weekday indexing is a classic silent failure.

### The business day

**Revision 1 assumed opening hours never cross midnight and threw `InvalidOpeningHours` when `close <= open`. That restriction is removed.** A lounge open 14:00 to 02:00 is the normal case for this domain, not an edge case.

That change forces a definition, because "day" is now ambiguous.

> **A business day `D` is the session that OPENS on local calendar date `D`. It runs from `open(D)` to `close(D)`, where `close(D)` rolls forward to local calendar date `D+1` whenever `close <= open`. Every cell in that session belongs to business day `D`, including cells whose own local calendar date is `D+1`.**

`GET /availability?date=2026-08-07` returns the Friday-night session: the 14:00 cells, the 23:30 cell, and the 01:30 cell that lands on Saturday morning. The Saturday-morning cells do **not** appear under `?date=2026-08-08`.

Justification, since this is a rule with real consequences:

- It matches how the business thinks and how a customer thinks. Nobody books "Saturday 1am"; they book "Friday night".
- The alternative, assigning each cell to its own local calendar date, splits one continuous session across two responses. A customer looking at Friday would see the session cut off at midnight with no indication that it continues, and a customer looking at Saturday would see two disconnected blocks (Friday's tail and Saturday's own opening) in one list with no way to tell them apart.
- It makes the weekday lookup unambiguous: the session uses `openingHours[weekday(D)]`, one entry, not a blend of two.
- It makes `blackoutDates` unambiguous: a blackout on `D` cancels the whole session, tail included.
- It makes the Mongo query window exactly `[openInstant(D), closeInstant(D))`, which is tighter and simpler than revision 1's local-midnight-to-local-midnight window, and it needs no separate handling for the crossing case.

**Config constraint that makes the rule total:** `closeInstant - openInstant` must be at most 24 hours. Longer than that and consecutive business days overlap, so one cell would belong to two sessions and appear in two availability responses. `InvalidOpeningHoursError` survives from revision 1 but its meaning changes: it is now thrown when the resolved session exceeds 24 hours, not when `close <= open`. Validated at seed time and again in the engine.

### Grid generation rule

For a requested business date `D` and venue `V`:

1. `wd = DateTime.fromISO(D, { zone: V.timezone }).weekday % 7`. If `V.openingHours[wd]` is `null`, return `closed / weekday_closed`. If `D` is in `V.blackoutDates`, return `closed / blackout`.
2. `openLocal  = DateTime.fromISO(`${D}T${hours.open}`,  { zone: V.timezone })`
3. `closeLocal = DateTime.fromISO(`${D}T${hours.close}`, { zone: V.timezone })`
4. **If `hours.close <= hours.open` as wall-clock strings, `closeLocal = closeLocal.plus({ days: 1 })`.** Compare the strings, not the resolved instants. `"02:00" <= "14:00"` is a lexicographic comparison on zero-padded `HH:MM`, which is the same as a numeric comparison, and it is decided before any zone math can perturb it.
5. Resolve DST ambiguity at both boundaries (rules below) to get `openInstant` and `closeInstant` as epoch milliseconds.
6. If `closeInstant - openInstant > 86_400_000`, throw `InvalidOpeningHoursError`.
7. If `closeInstant <= openInstant + V.gridMinutes * 60_000`, return `closed / no_valid_hours`.
8. Emit cells by **real-time arithmetic on epoch milliseconds**, never by local-time arithmetic:
   ```
   const stride = V.gridMinutes * 60_000;
   for (let t = openInstant; t + stride <= closeInstant; t += stride)
       emit { cellStartMs: t, cellEndMs: t + stride }
   ```

Step 4 is the only new line, and it is the one that has to be `plus({ days: 1 })` rather than `plus({ hours: 24 })`. Luxon documents that higher-order units are calendar-aware: `plus({ days: 1 })` on 02:00 gives 02:00 the next local day whatever DST does in between, while `plus({ hours: 24 })` on the same value gives 01:00 or 03:00 on a transition day. We want the wall-clock intention ("we close at 2am") preserved, so the calendar unit is correct and the elapsed unit is wrong.

Step 8 is the load-bearing rule and is unchanged. **Never step the grid with `local.plus({ minutes })` on a zoned DateTime.** Stepping by wall-clock is what produces nonexistent cells on spring-forward and duplicate cells on fall-back. Stepping by elapsed milliseconds from a single resolved anchor cannot produce either, because it never constructs an intermediate local time at all.

Note that the stride is now `gridMinutes` alone. Revision 1's stride was `slotMinutes + bufferMinutes`, because a booking was exactly one slot and the buffer could hide in the gap between slot starts. With variable-length bookings the buffer follows the end of each booking, and the end varies, so it cannot live in a uniform stride. Section 3 works that through.

### Spring forward (the gap: a local time that does not exist)

Example: `America/New_York`, 2026-03-08, clocks jump 02:00 to 03:00. Local 02:30 does not exist.

**Interior cells:** by construction, none exist. Stepping by elapsed milliseconds skips over the gap. A session open 14:00 to 02:00 that night produces cells whose local labels read 14:00 through 01:30 with 02:00 never reached, because the closing instant arrives an hour earlier in elapsed time than on a normal night. **That session yields two fewer 30-minute cells than a normal night, and that is the intended answer, not a bug.** The lounge genuinely had one fewer hour of trading.

**A session that closes exactly at the transition, which is the common case here:** a lounge closing at 02:00 in a zone that springs forward at 02:00 has a nonexistent closing time. Luxon advances it to 03:00 local, which is the *same instant* the transition produces (01:59:59 EST is immediately followed by 03:00:00 EDT). So `closeInstant` lands exactly on the transition instant, which is the right answer and needs no special case. Assert this in a test rather than trusting the reasoning.

**A session that opens inside the gap** (venue opens 02:30 on the transition date): rely on documented Luxon behavior, which advances a nonexistent local time forward by one hour, so 02:30 resolves to 03:30 local. Deterministic and verified in Luxon's `docs/zones.md`. The engine does not override it.

### Fall back (the overlap: a local time that occurs twice)

Example: `America/New_York`, 2026-11-01, clocks fall from 02:00 back to 01:00. Local 01:30 occurs twice, at UTC 05:30 and UTC 06:30.

**Interior cells:** both occurrences are generated and both are bookable. This is correct. The lounge is physically open for one extra hour of real time that night and can genuinely sell it. Because cell identity is a UTC instant, the two 01:30 cells have different `cellStart` values, get different entries in `uniq_slot_claim`, and never collide. The ambiguity is a display problem, never a correctness problem.

**A session that closes at 02:00 across a fall-back:** local 02:00 occurs once (the repeated hour is 01:00 to 01:59), so the closing boundary is unambiguous and the session is one hour longer than usual. Two extra cells.

**A session that closes inside the ambiguous hour** (closes 01:30 on the fall-back date): `getPossibleOffsets()` returns two candidates. Take the later one, per the boundary rule below, so the session runs through both passes of 01:00 to 01:30.

**Display rule:** every cell in the availability response carries both `startsAt` (ISO 8601 with `Z`, the identity) and `localLabel` (Luxon `toFormat("yyyy-MM-dd HH:mm ZZZZ")`, for example `"2026-11-01 01:30 EDT"` versus `"2026-11-01 01:30 EST"`). The zone abbreviation disambiguates them for a human. Clients must send back `startsAt`, never `localLabel`.

### Boundary disambiguation rule, both directions

```ts
const candidates   = local.getPossibleOffsets();       // 1 or 2 entries
const openInstant  = candidates[0].toMillis();                     // EARLIEST
const closeInstant = candidates[candidates.length - 1].toMillis(); // LATEST
```

Opening time takes the **earliest** candidate, closing time takes the **latest**. This maximizes the open window, which matches the intuition "we are open from 2pm until 2am, whatever the clock does in between". Choosing the other way would silently close an hour early. The rule is written down precisely because Luxon documents its own default as undefined.

The rule is applied to `closeLocal` **after** the `plus({ days: 1 })` roll in step 4, not before. Rolling first and disambiguating second means the ambiguity is evaluated against the actual closing local time on the actual local day it lands on, which is the only place it can be evaluated correctly.

### The Mongo query window

`GET /availability?date=D` reads existing claims from Mongo. The UTC window is **`[openInstant(D), closeInstant(D))`**, the resolved session boundaries. It is not `[D T00:00Z, D+1 T00:00Z)` and it is not local midnight to local midnight.

Revision 1 warned that a naive UTC day boundary loses bookings for any venue not near UTC+0 and called it the second-most-common bug in this class of system after DST itself. That warning stands. The business-day rule makes the fix simpler than it was: the window is exactly the session, computed by the same function that generated the grid, so there is no second place where a day boundary can be derived and therefore no second place it can be derived wrongly. `generateSlotGrid` returns `windowStartMs` and `windowEndMs` and the caller uses them verbatim.

When the venue is closed on `D` (weekday closed, blackout, or no valid hours), `windowStartMs` and `windowEndMs` are set to local midnight `D` and local midnight `D+1`. The caller skips the Mongo read entirely in that case, so the values are informational only.

### Half-hour and quarter-hour offset zones

`Asia/Kolkata` is UTC+05:30. With `gridMinutes: 30` and a 14:00 local opening, cells land on `:30` and `:00` in UTC. `Asia/Kathmandu` is UTC+05:45, so cells land on `:15` and `:45` in UTC. Neither is a problem for a design whose cell identity is an instant, but both break any code that assumes a cell boundary aligns to a UTC half hour. There is no such assumption in this design, and there are tests to keep it that way.

### Edge cases that must have tests

Engine tests, pure, no database. The first 21 carry over from revision 1 with `slotMinutes` reinterpreted as `gridMinutes` and per-slot assertions restated per cell. Cases 22 through 33 are new.

1. Normal session, venue 10:00 to 18:00, `gridMinutes: 30` gives exactly 16 cells, first at local 10:00, last ending exactly at 18:00.
2. Trailing partial cell is dropped: 10:00 to 10:50 gives 1 cell, not 2.
3. `gridMinutes` that does not divide 60 is rejected at config validation.
4. **Spring forward, interior:** `America/New_York`, 2026-03-08, hours 00:00 to 06:00 gives 10 cells, not 12. Assert no emitted `localLabel` contains `02:`. Assert every consecutive pair differs by exactly 1,800,000 ms.
5. **Spring forward, opening boundary:** venue opens 02:30 on the transition date. Assert the first cell's local label is 03:30, Luxon's documented forward shift.
6. **Fall back, interior:** `America/New_York`, 2026-11-01, hours 00:00 to 06:00 gives 14 cells, not 12. Assert exactly two cells have local hour and minute 01:00 and exactly two have 01:30. Assert their `startsAt` values differ by 3,600,000 ms. Assert their `localLabel` values differ, EDT versus EST.
7. **Fall back, closing boundary:** venue closes at 01:30 on the transition date. Assert the closing instant is the later of the two candidates, so the last cell is the EST one.
8. Southern-hemisphere transitions in the opposite calendar direction: `Australia/Sydney`, October (spring forward) and April (fall back). Guards against a rule that hardcodes northern-hemisphere months.
9. Half-hour-offset zone with no DST: `Asia/Kolkata`, UTC+05:30. Assert cell instants land on UTC `:00` and `:30`, and that local labels read `:00` and `:30`.
10. Zone with a historical offset change but no current DST: `Asia/Shanghai`.
11. Weekday closed (`openingHours["0"] === null`) gives `closed.reason === "weekday_closed"`, zero cells, window boundaries still populated.
12. Blackout date gives `closed.reason === "blackout"`.
13. Weekday index mapping: all seven days of one week map to the correct `openingHours` entry. Explicitly assert Sunday maps to `"0"`.
14. Lead time: `nowMs` set mid-session, `leadTimeMinutes: 60`. Cells before `now + 60min` are `past`, the one immediately after is not.
15. Max advance: a date beyond `maxAdvanceDays` returns every cell as `too_far_ahead`.
16. Maintenance window partially overlapping a cell marks it `maintenance`. Half-open boundary check: a window ending exactly at cell start does **not** mark it, and a window starting exactly at cell end does **not** mark it.
17. Maintenance window spanning a DST transition covers the correct number of real cells.
18. State precedence: a cell that is simultaneously booked and held returns `booked`.
19. Empty station list gives empty cells and `closed === null`.
20. Session longer than 24 hours (open 14:00, close 15:00 next day) throws `InvalidOpeningHoursError`.
21. Determinism: calling `computeAvailability` twice with identical input returns deeply equal output. Guards against a hidden `Date.now()` or `Math.random()`.
22. **Midnight crossing, basic:** `Asia/Kolkata`, hours 14:00 to 02:00 gives 24 cells. First cell local 14:00 on `D`, last cell starting local 01:30 on `D+1` and ending at 02:00 on `D+1`.
23. **Midnight crossing, cell ownership:** with the same venue, the grid for `2026-08-07` includes the instant for local 01:30 on 2026-08-08, and the grid for `2026-08-08` does **not**. Assert the two sessions' cell sets are disjoint.
24. **Midnight crossing, weekday lookup:** a venue closed Saturdays (`openingHours["6"] === null`) but open Friday 14:00 to 02:00. Assert the Friday session still emits its Saturday-morning cells, because the lookup keys on the opening weekday. Assert the Saturday date itself returns `weekday_closed`.
25. **Midnight crossing, blackout:** a blackout on `D` removes the whole session including the `D+1` tail.
26. **Midnight crossing over spring forward, closing at the transition:** `America/New_York`, 2026-03-07 session, hours 14:00 to 02:00. Local 02:00 on 2026-03-08 does not exist. Assert the session yields **the same** cell count as the neighboring nights (24 at a 30-minute grid), not fewer. Corrected 2026-08-06 after being verified against real Luxon output: local 02:00 does not exist, Luxon advances it to 03:00 EDT, and because EDT is UTC-4 while EST is UTC-5 the shift cancels exactly. 02:00 EST and 03:00 EDT are the same instant, so the close lands where a normal night's close would. An hour is only lost when the gap falls in the session **interior**, which is case 27. Revision 2 asserted `two fewer cells` here, which contradicted its own prose two paragraphs earlier and was wrong.
27. **Midnight crossing over spring forward, closing after the transition:** same zone, hours 14:00 to 04:00. Assert the session is one hour shorter in elapsed time than a normal night and that no cell has a local label in the `02:` hour.
28. **Midnight crossing over fall back:** `America/New_York`, 2026-10-31 session, hours 14:00 to 02:00. Assert the session yields two more cells than the neighboring nights, that exactly two cells carry local `01:00` and two carry `01:30`, and that their labels differ.
29. **Midnight crossing over fall back, closing inside the ambiguous hour:** hours 14:00 to 01:30. Assert the later candidate is chosen, so both passes of 01:00 fall inside the session.
30. **Calendar roll versus elapsed roll:** a direct regression test asserting the midnight roll on a spring-forward night preserves the local closing hour and does not shift it. This test exists to fail loudly if someone rewrites the roll as elapsed-hour arithmetic.
31. **Quarter-hour offset zone:** `Asia/Kathmandu`, UTC+05:45, hours 14:00 to 02:00. Assert cell instants land on UTC `:15` and `:45` and that the count matches case 22.
32. **Window boundaries:** for every case above, `windowStartMs` equals the first cell's start, `windowEndMs` is at least the last cell's end, and `windowEndMs - windowStartMs <= 86_400_000`.
33. **Southern-hemisphere midnight crossing:** `Australia/Sydney`, hours 18:00 to 03:00, across both the October and April transitions. Combines cases 8 and 28.

---

## 3. Availability computation (`packages/engine`)

Pure functions. No I/O, no `Date.now()` reads, no config lookups. `now` is an explicit parameter. `packages/engine` gains one dependency, `luxon`, plus `@playstop/types`, which `docs/ARCHITECTURE.md` already sanctions.

Files: `packages/engine/src/grid.ts`, `packages/engine/src/availability.ts`, `packages/engine/src/pricing.ts`, re-exported from `index.ts`.

### Function 1: `generateSlotGrid`

```ts
export interface VenueSchedule {
  readonly timezone: string;
  readonly gridMinutes: number;
  readonly bufferMinutes: number;
  readonly openingHours: Readonly<Record<"0"|"1"|"2"|"3"|"4"|"5"|"6",
    { readonly open: string; readonly close: string } | null>>;
  readonly blackoutDates: readonly string[];
}

export interface GridCell {
  readonly cellStartMs: number;   // UTC epoch ms
  readonly cellEndMs: number;     // UTC epoch ms, exclusive
  readonly localLabel: string;    // "2026-11-01 01:30 EDT"
}

export type GridResult =
  | { readonly kind: "open"; readonly cells: readonly GridCell[];
      readonly windowStartMs: number; readonly windowEndMs: number }
  | { readonly kind: "closed"; readonly reason: "weekday_closed" | "blackout" | "no_valid_hours";
      readonly windowStartMs: number; readonly windowEndMs: number };

export function generateSlotGrid(
  venue: VenueSchedule,
  businessDate: string,   // "YYYY-MM-DD", the date the session OPENS on
): GridResult;
```

`windowStartMs` and `windowEndMs` are the resolved session boundaries in UTC ms, returned even when closed, because the caller needs a window to build the Mongo query. Throws `InvalidOpeningHoursError` when the resolved session exceeds 24 hours.

### Function 2: `computeAvailability`

```ts
export interface StationInput {
  readonly stationId: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: "ps5" | "ps3" | "ps2" | "racing-sim";
  readonly capacity: number;
  readonly hourlyRateMinor: number;
  readonly minSlots: number;
  readonly maxSlots: number;
  readonly maintenanceWindows: readonly { readonly startsAtMs: number; readonly endsAtMs: number }[];
}

export interface OccupiedCell {
  readonly stationId: string;
  readonly cellStartMs: number;
}

export interface AvailabilityInput {
  readonly venue: VenueSchedule & { readonly leadTimeMinutes: number; readonly maxAdvanceDays: number };
  readonly businessDate: string;
  readonly stations: readonly StationInput[];   // caller passes ACTIVE stations only
  readonly claims: readonly OccupiedCell[];     // confirmed slot_claims, from Mongo
  readonly holds: readonly OccupiedCell[];      // from Redis; empty array when Redis is degraded
  readonly nowMs: number;
}

export type CellState = "free" | "held" | "booked" | "maintenance" | "past" | "too_far_ahead";

export interface AvailabilityCell {
  readonly stationId: string;
  readonly startsAt: string;   // ISO 8601 UTC, e.g. "2026-11-01T05:30:00.000Z"
  readonly endsAt: string;
  readonly localLabel: string;
  readonly state: CellState;
}

export interface AvailabilityResult {
  readonly businessDate: string;
  readonly timezone: string;
  readonly gridMinutes: number;
  readonly closed: null | { readonly reason: "weekday_closed" | "blackout" | "no_valid_hours" };
  readonly cells: readonly AvailabilityCell[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;
}

export function computeAvailability(input: AvailabilityInput): AvailabilityResult;
```

**State precedence, applied in this exact order** (first match wins, so the result is deterministic and testable):

1. `cellStartMs < nowMs + leadTimeMinutes * 60_000` gives `past`
2. `cellStartMs > nowMs + maxAdvanceDays * 86_400_000` gives `too_far_ahead`
3. Overlaps any maintenance window (half-open intersection: `cellStart < windowEnd && cellEnd > windowStart`) gives `maintenance`
4. Present in `claims` gives `booked`
5. Present in `holds` gives `held`
6. Otherwise `free`

Booked ranks above held deliberately: if both exist for the same cell (a hold that was confirmed but whose release lost a race), the truthful answer is `booked`.

**The response is per cell, not per bookable range.** A client that wants a 90-minute session picks a start cell and checks that it plus the next two cells are all `free` on the same station. The engine does not enumerate ranges. Enumerating every legal (start, length) pair for 15 stations over a 24-cell session is roughly 15 x 24 x 8 entries of mostly redundant data, and the client already has everything it needs to compute it. The server re-validates the full range at confirm regardless, so a client that computes it wrong gets a clean 409 rather than a bad booking.

### Function 3: `priceBooking`

```ts
export function priceBooking(
  station: Pick<StationInput, "hourlyRateMinor">,
  gridMinutes: number,
  slotCount: number,
): number;   // integer minor units
```

`hourlyRateMinor * slotCount * gridMinutes / 60`, asserted to be an integer. Pure, so it is unit-testable without a database, and it lives in the engine so `apps/web` can show a running total without duplicating the formula. **The server recomputes it at confirm and never accepts a client-supplied price.**

### The buffer, and whether the unique index is still a complete backstop

Revision 1 said this, and it was true then:

> The buffer is baked into the grid stride, not evaluated per booking. Consequence: a confirmed slot cannot conflict with its neighbor by construction, because neighbors are `slotMinutes + bufferMinutes` apart. This is why the single-column unique index on `startsAt` is a *complete* backstop rather than a partial one.

**That reasoning does not survive variable-length bookings, and the conclusion has to be re-derived.**

The old argument worked because every booking was exactly one slot and every slot start was `slotMinutes + bufferMinutes` after the previous one, so the gap between any two adjacent bookings was structurally at least `bufferMinutes`. Uniqueness on the start instant was therefore equivalent to non-overlap-plus-buffer.

With variable length, the buffer has to follow the *end* of a booking, and the end varies per booking. There is no uniform stride that can encode it. A grid with a `gridMinutes + bufferMinutes` stride would put a gap after every cell rather than after every booking, which would make a 3-cell booking non-contiguous in real time. So the stride is `gridMinutes` alone, and the buffer has to be handled somewhere else.

Take the two properties separately.

**Non-overlap is still complete, and it is stronger than before.** Cells tile the session with no gaps and every booking occupies a contiguous run of whole cells. Two bookings on the same station overlap in real time if and only if their cell runs intersect, and if their cell runs intersect they share at least one cell, which means two confirmed `slot_claims` documents with the same `(venueId, stationId, cellStart)`. `uniq_slot_claim` rejects that. So **the unique index catches every possible overlap**, with no interval arithmetic anywhere in the write path. This is a better guarantee than revision 1 had, because it does not depend on all bookings being the same length.

**The buffer is not covered by that argument.** Booking A occupying cells 1 to 3 and booking B occupying cells 4 to 5 violate no uniqueness constraint, and if `bufferMinutes > 0` they violate the changeover requirement.

The fix, and it keeps the completeness property: **make the buffer occupy cells.**

```
bufferSlotCount = ceil(bufferMinutes / gridMinutes)
```

A confirmed booking writes `slotCount + bufferSlotCount` claim documents: `slotCount` with `kind: "play"` followed by `bufferSlotCount` with `kind: "buffer"`. Both kinds are in the same partial unique index, so a following booking that would start inside the changeover collides on a buffer cell and is rejected by the same mechanism, in the same transaction, with the same error. **With buffer cells materialized, `uniq_slot_claim` is a complete backstop for overlap and buffer together.** No interval-overlap check exists anywhere in the write path, which is the property revision 1 wanted and now has for the right reason.

Three consequences to be explicit about:

- **The buffer is charged to the *following* booking's opportunity, not to the customer.** `bookings.endsAt` covers play cells only, and `priceBooking` uses `slotCount` only. A customer pays for what they play.
- **Buffer cells that fall past closing are simply not written.** Nothing follows them, so there is nothing to protect. The claim builder truncates the buffer run at `windowEndMs`.
- **`bufferMinutes` is rounded up to whole cells.** A 10-minute buffer on a 30-minute grid costs a full 30-minute cell. That is a real cost and it is why the seeded venue sets `bufferMinutes: 0`.

**Recommendation for this venue: `bufferMinutes: 0`.** A gaming lounge has no cabinet to wipe down between sessions. Staff hand over the controllers as one group leaves and the next sits, and a 30-minute grid already leaves slack inside the last cell. Setting a non-zero buffer would silently burn one paid cell in four for a changeover that takes two minutes. The mechanism above is specified so that a non-zero buffer is correct if a future venue needs one, not because this venue does.

Ceiling named: buffer is per venue, not per station kind. A racing sim that needs a wheel recalibration between groups while a PS5 does not would want a per-station buffer. That is a per-station field and a one-line change in the claim builder, because the buffer is already materialized per booking rather than baked into a global stride. Upgrade path is genuinely cheap now, which it was not in revision 1.

### The claim builder

One pure function, because getting it wrong is the most expensive bug available and it deserves unit tests without a database.

```ts
export function buildClaimCells(
  grid: readonly GridCell[],
  startsAtMs: number,
  slotCount: number,
  bufferSlotCount: number,
): { readonly playMs: readonly number[]; readonly bufferMs: readonly number[] };
```

Rules:

- `startsAtMs` must equal some `grid[i].cellStartMs` exactly. If not, the caller raises `SLOT_NOT_ON_GRID`.
- Play cells are `grid[i .. i + slotCount - 1]`. If the run would run past the end of `grid`, the caller raises `SLOT_OUT_OF_WINDOW`: a booking may not extend past closing.
- Buffer cells are `grid[i + slotCount .. i + slotCount + bufferSlotCount - 1]`, truncated at the end of `grid`.
- Cells are taken **from the grid array**, never computed as `startsAtMs + n * stride`. On a DST night the grid is not a uniform arithmetic sequence in local terms, and the grid array is the only artifact that knows where the real cell boundaries are. Recomputing them here would reintroduce the exact bug the grid generator exists to prevent.

Tests: contiguity, truncation at close, refusal to extend past close, correct behavior when the run spans a DST transition (a 4-cell booking starting at local 01:00 on a fall-back night occupies both 01:00 cells and both 01:30 cells, and its `endsAt` is 2 hours of elapsed time after its start even though the local clock advanced only 1 hour).

---

## 4. Concurrency: hold, confirm, cancel

### The invariant, stated once

**Redis holds are advisory UX. The Mongo unique index `uniq_slot_claim` is truth.** Every decision below follows from that sentence. A Redis outage degrades the experience (more users see 409 after clicking confirm) and never degrades correctness (two groups on one station remains impossible).

Revision 1 added a second claim, "no transactions anywhere", and named `slot_claims` as a deferred upgrade path. **That upgrade path has been taken.** The design now uses exactly one transaction on the confirm path and one on the cancel path. It uses no distributed lock, no two-phase commit, and no saga. The transaction exists for one reason: a booking spanning N cells must claim all N or none, and N single-document inserts cannot give that.

### Redis client

**ioredis over TCP (`rediss://`), one shared connection, created in `apps/api/src/redis.ts`.**

Chosen over `@upstash/redis` (REST): Render runs a long-lived Node process, not a serverless function. A persistent TCP connection amortizes to near-zero per-command cost, where the REST client pays a handshake or keepalive round trip per command. Upstash documents ioredis as a first-class client with a `rediss://` connection string.

Revision 1 gave a second reason, that ioredis speaks the same protocol to a local `redis:7` container and to Upstash so local dev and production run the same client. **That reason is gone: there is no local Redis any more.** The remaining reason, connection reuse on a long-lived process, still holds on its own, and there is a third: the CI service container in section 9 is a real `redis:7-alpine`, so ioredis still spans both environments, just not a developer's laptop.

Tradeoff accepted: ioredis's long-term maintenance posture is uncertain, flagged in section 0. The blast radius is one file exporting five functions.

Connection options, all load-bearing:

```ts
new Redis(env.REDIS_URL, {
  commandTimeout: 500,          // ms. Singapore round trip is real; 300 was tuned for localhost.
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,      // fail fast into degraded mode, do not queue
  enableOfflineQueue: false,    // CRITICAL: without this, commands hang until reconnect
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 200, 5000),
});
```

`commandTimeout` and `connectTimeout` are raised from revision 1's values. Revision 1 assumed a Redis on localhost. Every Redis call now crosses the public internet to Singapore, so 300 ms would trip on ordinary latency and put the API permanently in degraded mode. Measure the real p99 against the provisioned Upstash database during step 4 and tune from the measurement, not from this number.

`enableOfflineQueue: false` is the single most important option. With the default `true`, a command issued while Redis is down sits in an in-memory queue instead of rejecting, so a confirm request hangs rather than degrading. Every Redis call must either succeed inside `commandTimeout` or throw, so the caller can fall through to the Mongo path.

Every Redis call is wrapped:

```ts
async function tryRedis<T>(op: () => Promise<T>, fallback: T): Promise<{ value: T; degraded: boolean }>
```

which catches everything, logs `{ level: "warn", event: "redis_degraded", requestId }`, and returns `{ value: fallback, degraded: true }`. Redis exceptions never reach the HTTP error handler.

### Key naming

```
ps:{env}:{venueId}:hold:{stationId}:{cellStartEpochMs}
```

Concretely: `ps:dev:6716a1f2c9e4b8001f2a3d55:hold:6716a1f3c9e4b8001f2a3d61:1762060200000`

- `ps:` namespace prefix so a shared Redis does not collide with anything else.
- `{env}` (`dev` or `prod`) is new in this revision. Dev and prod are separate Upstash databases (the free tier allows up to 10), so this is belt and braces rather than the primary isolation. It costs four bytes and it means a mistyped `REDIS_URL` produces zero cross-environment interference instead of silent, plausible-looking wrong answers.
- `{venueId}` is the tenant segment and is present on **every** key without exception. Key construction goes through one function, `holdKey(env, venueId, stationId, cellStartMs)`, in `apps/api/src/holds.ts`. No route builds a key by string concatenation. This is the Redis-side equivalent of "every query filters on venueId".
- `cellStartEpochMs` rather than an ISO string: shorter, and there is no way to spell the same instant two different ways.

Scan pattern for availability: `ps:{env}:{venueId}:hold:*`. **Do not use `KEYS`.** Use `SCAN` with `MATCH` and `COUNT 500`, filtering parsed cell starts to the session window. One venue, 15 stations, and a 5-minute hold TTL means the live hold keyspace is a few dozen keys at any moment. Section 8 redoes the request-budget arithmetic under the corrected Upstash quota and confirms this is still the right call.

`// ponytail: SCAN over a small keyspace; switch to a per-venue-day SET index if concurrent holds exceed ~1k.`

### Holds now cover N cells, so acquire and release are both Lua

Revision 1 used a bare `SET key value NX PX ttl` and correctly noted that one command needs no script. A hold now covers `slotCount` consecutive cells, and N separate `SET NX` calls are not atomic across the set: two clients can each win a disjoint subset, neither gets a usable hold, and both leave keys behind. Upstash supports `EVAL` and `EVALSHA` (verified), and Redis runs a script as a single unit, so a script is the direct fix.

**Acquire** (`holdAcquire`), `KEYS` = the N cell keys, `ARGV[1]` = holdId, `ARGV[2]` = ttlMs:

```lua
for i = 1, #KEYS do
  if redis.call("EXISTS", KEYS[i]) == 1 then return 0 end
end
for i = 1, #KEYS do
  redis.call("SET", KEYS[i], ARGV[1], "PX", ARGV[2])
end
return 1
```

Returns 1 if every cell was free and all N are now held by this caller, 0 if any cell was taken and nothing was written. All or nothing, no partial holds, no rollback path to get wrong.

**Release** (`holdRelease`), same `KEYS`, `ARGV[1]` = holdId:

```lua
local deleted = 0
for i = 1, #KEYS do
  if redis.call("GET", KEYS[i]) == ARGV[1] then
    deleted = deleted + redis.call("DEL", KEYS[i])
  end
end
return deleted
```

Compare-and-delete per cell, skipping any cell this caller no longer owns. Deleting without comparing is a correctness bug: client A's hold expires, client B acquires the same cells, client A then calls release and deletes B's hold. The comparison has to be atomic with the delete, which two commands cannot be.

Both are registered once at startup via ioredis `defineCommand`, **without a fixed `numberOfKeys`**, so the key count is passed per call. The number of keys varies with `slotCount`, so a fixed count would be wrong for every booking that is not exactly that length. ioredis transparently uses `EVALSHA` with an `EVAL` fallback on `NOSCRIPT`.

The key count is bounded by `station.maxSlots`, so a script never iterates more than a handful of keys.

TTL: `HOLD_TTL_SECONDS`, env-configured, **default 300 (5 minutes)**, applied identically to every cell. Long enough for a human to type a name and click, short enough that an abandoned checkout does not sit on a physical station.

Value: the `holdId`, a plain UUID v4 string. Not JSON, because the only question ever asked of it is "does this equal the holdId the client presented".

**Expiry release:** nothing to do. `PX` handles it. No sweeper, no cron, no cleanup job. All N keys were set with the same TTL in the same script, so they expire together within milliseconds of each other.

Explicit release returns 204 whether the script deleted 0 keys or N. Releasing a hold you no longer own is not an error worth surfacing; the desired end state, "I am not holding this", is true either way.

Before issuing the acquire script, the route also checks Mongo for existing confirmed claims across the requested cells. If any exist, return 409 `SLOT_TAKEN` without touching Redis. This is a courtesy check, not a lock; a cell could be claimed microseconds later. It exists so the common case gives an accurate error instead of handing out a hold on an already-sold range.

### Confirm: the exact sequence

`POST /v1/venues/:venueSlug/bookings`

```
 1. Validate body with Zod. Fail -> 400 VALIDATION_FAILED.
 2. Resolve venue by slug (middleware). Not found -> 404 VENUE_NOT_FOUND.
 3. Require Idempotency-Key header. Missing/malformed -> 400 IDEMPOTENCY_KEY_REQUIRED.
 4. Idempotency claim (section 5). May short-circuit with a replay or a conflict.
 5. Load the station: { _id: stationId, venueId, status: "active" }.
      Absent, retired, or another venue's -> 404 STATION_NOT_FOUND.
 6. Per-station validation against the loaded document:
      partySize > station.capacity                -> 422 PARTY_SIZE_EXCEEDS_CAPACITY
      slotCount < minSlots || > maxSlots          -> 422 SLOT_COUNT_OUT_OF_RANGE
 7. Grid validation against server-side venue config:
      generateSlotGrid(venue, businessDateOf(startsAt)) must contain startsAt exactly
                                                  -> else 422 SLOT_NOT_ON_GRID
      buildClaimCells run would extend past close -> 422 SLOT_OUT_OF_WINDOW
      any play cell before now+leadTime, or beyond maxAdvanceDays
                                                  -> 422 SLOT_OUT_OF_WINDOW
      any play or buffer cell inside a maintenance window
                                                  -> 409 SLOT_UNAVAILABLE
 8. Hold verification (decision table below).
 9. Build every document in memory: the booking, the N+B claims, the finalized
      idempotency update. Generate the confirmationCode and all ObjectIds here.
10. ONE TRANSACTION: insert booking, insertMany claims, finalize idempotency.
11. On success: fire-and-forget hold release (errors ignored, the TTL is the backstop).
12. 201 with the booking.
```

Step 7 runs on the server against server-side venue config. **A client-supplied `startsAt` is never trusted to be a legal cell boundary, and a client-supplied `slotCount` is never trusted to fit.** Without this check a client could book at 14:07 and slip between cells, defeating the unique index entirely. This is trust-boundary validation and it must not be simplified away.

Step 6 is new in this revision and cannot be done in Zod, because the bounds live on the station document. Zod applies static outer bounds (`partySize` 1..8, `slotCount` 1..48) as a cheap first gate that rejects obvious garbage before a database read; the station-specific check in step 6 is the real one. Both exist on purpose: the Zod bound protects the database from unbounded input, the step 6 bound protects the business rule.

Step 9 is a rule about transaction hygiene, not an optimization. `withTransaction` may run its callback more than once, so the callback must be a pure write of already-built documents. Generating a confirmation code or an ObjectId inside the callback would produce different documents on each retry, which makes a failure hard to reason about and makes the "same code on retry" property untrue. Build first, write second.

### Step 8: hold verification decision table

`holdId` is **optional** in the request body. That is what makes graceful degradation possible.

Verification reads all N play-cell keys in one `MGET` and inspects the array.

| `holdId` present? | Redis reachable? | `MGET` result | Action |
|---|---|---|---|
| yes | yes | every entry equals `holdId` | Proceed. Normal path. |
| yes | yes | any entry is a different non-null value | **409 `SLOT_HELD`.** Someone else holds part of the range. Checked before the expiry case because it is the more informative answer. |
| yes | yes | some entries null, none foreign | **410 `HOLD_EXPIRED`.** Fail fast and honestly: part of the range may have gone to someone else while the client dawdled. |
| yes | **no** | n/a | **Proceed.** Log `redis_degraded`. Redis being down must never block a booking. |
| **no** | either | n/a | **Proceed.** Hold-less confirm is legal. |

Only play cells are verified. Buffer cells are a server-side concept the client never sees and never holds.

The last two rows are the degradation story made concrete. When Redis is unavailable, or a client skips the hold step, the system falls back to slower-but-correct: every client races straight at the unique index, exactly one wins, the losers get a clean 409. Throughput and UX suffer, because users learn they lost only after submitting. Correctness does not. **The system never refuses to book because Redis is down.** Refusing would turn a cache outage into a full booking outage, which is a worse failure for a business whose product is selling time.

Availability degrades in the other direction: when Redis is unreachable, `holds` is passed to the engine as `[]`, so cells held by other users show as `free`. The response carries `degraded: true` so a client can show a "live availability unavailable, confirmations may fail" notice. Showing an optimistic `free` and taking a 409 beats showing everything as unavailable.

### Step 10: the transaction, exactly

```ts
const session = mongoClient.startSession();
try {
  await session.withTransaction(
    async () => {
      await bookings.insertOne(bookingDoc, { session });
      await slotClaims.insertMany(claimDocs, { session, ordered: true });
      await idempotency.updateOne(
        { _id: idemId },
        { $set: { state: "completed", statusCode: 201, response: responseBody, bookingId: bookingDoc._id } },
        { session },
      );
    },
    {
      readConcern:    { level: "local" },
      writeConcern:   { w: "majority" },
      readPreference: "primary",
      timeoutMS:      8000,
    },
  );
} finally {
  await session.endSession();
}
```

Line by line, and why each part is what it is.

**The boundary.** Exactly three writes across three collections, all in one database. Nothing else is inside: no Redis call, no HTTP call, no code generation, no validation. A transaction holds locks on a shared replica set with a 100 ops/sec ceiling, so it holds for as few round trips as possible.

**`ordered: true` on `insertMany`.** The driver stops at the first write error rather than attempting the rest. Inside a transaction the whole thing aborts either way, so unordered would only buy extra failed writes against the ops/sec budget. Verified: ordered bulk writes stop at the first write error.

**Sequential awaits, never `Promise.all`.** The driver docs state explicitly that operations must not run in parallel inside a `withTransaction` callback. This is not a style preference.

**Errors are rethrown, never swallowed inside the callback.** Also from the driver docs: swallowing an error inside the callback leaves the driver unable to manage transaction state correctly. The `catch` lives outside `withTransaction`.

**`writeConcern: { w: "majority" }`** on the commit. Anything weaker means a confirmed booking can be lost to a replica set election, which is worse than a double booking, because the customer holds a confirmation code for a session that no longer exists.

**`readConcern: { level: "local" }`** rather than `snapshot`. The transaction reads nothing. `snapshot` would buy consistency guarantees for reads that do not happen, at a cost on a shared tier.

**`timeoutMS: 8000`.** This is the option people leave off and regret. Verified in the driver specification: with `timeoutMS` unset, `withTransaction` enforces a **120-second** retry ceiling that is otherwise not configurable. Under contention on a popular cell the loser can spend a long time in the transient-retry loop while an HTTP request sits open on a Render free instance. Eight seconds is roughly twenty times the expected commit latency to Singapore and still short enough that a user gets an answer. When the budget is exhausted the driver throws `MongoOperationTimeoutError`, mapped to **503 `BOOKING_TIMEOUT`** with `Retry-After: 2`. Do not map it to 409: the booking genuinely might have committed, and telling a user "someone else took it" when it may be theirs is a lie. If the pinned driver predates client-side operation timeout, fall back to `maxCommitTimeMS` plus a hand-rolled deadline around the whole call and keep the same mapping.

**`session.endSession()` in a `finally`.** Sessions are a server resource. Leaking them against a 500-connection cap is a slow outage.

### What the loser of a race actually experiences

Two clients confirm overlapping cell ranges on the same station at the same instant. Both reach step 10.

The winner's `insertMany` succeeds and its transaction commits. The loser hits one of two states depending on timing, and the difference is worth knowing because it changes what shows up in the logs.

**Case 1: the winner has not committed yet.** The loser's insert conflicts with an uncommitted write on the same unique key. The server returns **`WriteConflict` (code 112)**, which carries the `TransientTransactionError` label. `withTransaction` sees the label and **restarts the entire callback automatically**. The application code never sees this error. The retry runs against a state where the winner has committed, which is case 2.

**Case 2: the winner has committed.** The loser's `insertMany` fails with a genuine duplicate key. The driver surfaces it as a **`MongoBulkWriteError`** (renamed from `BulkWriteError` in driver 4, a subclass of `MongoServerError`), with `code === 11000` and `writeErrors[0].code === 11000`, and a message containing `E11000 duplicate key error collection: playstop.slot_claims index: uniq_slot_claim`. **11000 carries neither `TransientTransactionError` nor `UnknownTransactionCommitResult`, so `withTransaction` does not retry it.** The transaction aborts and the error propagates.

**So: does the driver retry?** Yes, but only across the transient window between a competing write and its commit, and the whole retry budget is capped by `timeoutMS`. It never retries a genuine duplicate key.

The catch, outside `withTransaction`:

```ts
catch (err) {
  if (err instanceof MongoOperationTimeoutError) {
    throw new DomainError("BOOKING_TIMEOUT", 503, "Could not confirm in time. Try again.",
                          undefined, { "Retry-After": "2" });
  }
  if (err instanceof MongoServerError && err.code === 11000) {
    if (err.message.includes("uniq_slot_claim")) {
      throw new DomainError("SLOT_TAKEN", 409, "Part of that time was just booked by someone else.");
    }
    if (err.message.includes("uniq_booking_code")) {
      // confirmation code collision: regenerate the code and retry the whole confirm ONCE
    }
  }
  throw err;
}
```

Two unique indexes can now throw 11000 inside one transaction: `uniq_slot_claim` and `uniq_booking_code`. Disambiguation is by index name in the message, which the driver documents, rather than by `keyPattern`, which it does not. With 10 characters of Crockford base32 a code collision is a 2^50 event and will effectively never happen, but a silently-wrong 409 would be a nasty bug and three lines prevent it. On a second failure of the same kind, return 500.

**Partial multi-cell bookings are impossible.** All N+B claims and the booking commit together or not at all. There is no state in which cells 1 and 2 are claimed and cell 3 is not. Test I in section 9 asserts this directly rather than trusting the sentence.

API response for the loser:

```json
HTTP/1.1 409 Conflict
{
  "error": {
    "code": "SLOT_TAKEN",
    "message": "Part of that time was just booked by someone else.",
    "requestId": "01JB2X9K4Q7N3M8P"
  }
}
```

`details.conflictingCellStart` is added when `writeErrors[0].err.keyValue?.cellStart` is present and omitted otherwise. Useful for a client that wants to highlight which cell went. Never load-bearing, because `keyValue` is an unverified field (section 0).

### Fallback if transactions turn out to be unavailable on M0

Section 0 flags this as the one thing that cannot be settled by reading. If the step 0 smoke test fails, the options in order of preference are: move to Atlas Flex (paid, small, design unchanged), or restrict bookings to exactly one cell so a single `insertOne` suffices and this section reverts to revision 1's design.

**Do not build a compensating-delete pseudo-transaction that inserts claims one at a time and deletes them on failure.** A crash mid-compensation leaves permanently claimed cells on a physical station with no admin UI to clear them, which is the exact failure this milestone exists to prevent.

### Cancel

Revision 1 flagged the absence of a cancel path as a real hazard: anonymous booking plus no cancellation means one mistaken confirm locks a physical station forever, with no owner dashboard to undo it. That flag is now acted on.

**Route:** `POST /v1/venues/:venueSlug/bookings/:bookingId/cancel`, body `{ "confirmationCode": "..." }`.

**Authorization is the confirmation code, the same model as the booking read.** Whoever holds the code made the booking or was given it, and that is the entire access-control story until accounts exist. The code goes in the body rather than the query string so it does not land in access logs, proxy logs, or a `Referer` header. This differs from `GET /bookings/:id?code=` deliberately: a GET has nowhere else to put it, a POST does.

POST rather than DELETE: the booking document survives with `status: "cancelled"` rather than being removed, so DELETE would describe the wrong thing, and DELETE with a request body has patchy client and proxy support.

**No `Idempotency-Key` required.** Cancellation is naturally idempotent, as specified below, so the header would add a failure mode without adding a guarantee.

Sequence:

```
1. Validate body and path. Fail -> 400 VALIDATION_FAILED.
2. findOne({ _id: bookingId, venueId, confirmationCode }).
     Not found -> 404 BOOKING_NOT_FOUND. Wrong id, wrong code, and wrong venue
     are indistinguishable, deliberately.
3. If status === "cancelled" -> 200 with the booking as-is. Idempotent. Done.
4. If nowMs >= booking.startsAt -> 422 BOOKING_NOT_CANCELLABLE.
5. ONE TRANSACTION:
     bookings.updateOne(
       { _id, venueId, status: "confirmed" },
       { $set: { status: "cancelled", cancelledAt: now } })
     if matchedCount === 0 -> throw; the outer handler re-reads and takes path 3
     slotClaims.updateMany(
       { venueId, stationId, bookingId, status: "confirmed" },
       { $set: { status: "cancelled" } })
6. 200 with the cancelled booking.
```

**Yes, it is a transaction, for the same reason as confirm.** A booking marked cancelled while its claims stay confirmed leaves cells locked forever with no record pointing at them. Claims cancelled while the booking stays confirmed shows a customer a live booking on a station that has been resold. Both halves or neither.

**The step 5 filter on `status: "confirmed"` is what makes a concurrent double-cancel safe.** Two simultaneous cancels: one transaction's `updateOne` matches and the other's does not, because Mongo serializes them on the same document. The loser aborts, the outer handler re-reads, sees `cancelled`, and takes the step 3 path. Net result: one cancel, two 200s.

**Double cancel returns 200, not 409.** The desired end state, "this booking is cancelled", is true either way, and the response body is the cancelled booking. This matches the release-hold precedent earlier in this section: an operation whose whole purpose is to reach a state should succeed when the state is already reached. A client retrying a cancel over a flaky connection gets a clean answer instead of an error it has to special-case.

**Past and in-progress bookings cannot be cancelled: 422 `BOOKING_NOT_CANCELLABLE`.** The cutoff is `startsAt`, so cancellation is allowed any time before the session begins and never after. Cancelling an in-progress session raises a partial-refund question, and a partial cancel would have to free only the remaining future cells while leaving the elapsed ones claimed, which is a different operation with different pricing. Cancelling a finished session would rewrite a commercial record for no benefit. Ceiling named: no early-departure handling. Upgrade path: a `truncate` operation that lowers `endsAt`, cancels only the claims with `cellStart >= now`, and recomputes `totalMinor`, all inside the same transaction shape. About the same size as cancel itself.

**Buffer claims are cancelled with the play claims.** The `updateMany` filter does not mention `kind`, so both are freed. A cancelled booking should not leave a changeover gap behind it.

**Why this works, restated against the index:** `uniq_slot_claim` is partial on `status: "confirmed"`. Setting a claim to `cancelled` removes its entry from the index, which does two things at once. The cell stops being unique-constrained, so a new booking can claim it, and the cell stops appearing in the availability query, which filters on the same partial condition. **That is exactly the reasoning revision 1 gave for making the index partial from day one, and it still holds with claims.** Nothing else has to be invalidated, because nothing else caches occupancy. Redis holds are the only other occupancy signal, and they are TTL-bounded advisory state, not a cache of the truth.

Race between a cancel and a concurrent confirm on the freed cell: the confirm inserts a **new** claim document. The cancelled one still physically exists but is out of the partial index, so there is no conflict and no need to reuse or clean up the old row. Cancelled rows accumulate at the rate of cancellations, which is bounded by human behavior, and can be pruned later with a dated `deleteMany` if they ever matter.

`// ponytail: cancelled claims are kept as an audit trail with no TTL; prune with a dated deleteMany if the collection grows enough to notice.`

**Redis:** cancel does not touch Redis. The cancelled booking's cells were not held (the hold was released at confirm, or it expired), and any stale hold expires within `HOLD_TTL_SECONDS`.

---

## 5. Idempotency

Unchanged from revision 1 except for one thing: the success finalization moved inside the booking transaction. Everything else below stands as written.

### Accepting the key

Header `Idempotency-Key`, **required** on `POST /bookings`. Optional-with-a-default would let a client silently retry into a double booking, which is the exact failure this milestone exists to prevent.

Validation (Zod, in `packages/types`): string, 16 to 128 chars, `/^[A-Za-z0-9_-]+$/`. Clients should send a UUID v4. Missing gives 400 `IDEMPOTENCY_KEY_REQUIRED`. Malformed gives 400 `VALIDATION_FAILED`.

Not required on `POST /holds`: a hold is cheap, TTL-bounded, and a duplicate hold on the same cells by the same client is already handled by the acquire script returning 0. Not required on `POST /holds/release` or `POST /bookings/:id/cancel`: both are idempotent by construction.

### Storage location and retention

**Mongo, collection `idempotency`, 24-hour TTL via `{ expiresAt: 1 }` with `expireAfterSeconds: 0`.**

Not Redis. The whole design rests on Redis being expendable, and an idempotency record that vanishes with a cache restart would let a retry create a second booking. Replay guarantees must be as durable as the thing they guard. There is a second reason now: the record participates in the booking transaction, and only Mongo can do that.

24 hours comfortably exceeds any client-side retry budget while keeping the collection small. Tenant-scoped by construction, since `_id` is the venue id joined to the key, so two venues can use the same key string without interference.

### The claim sequence

```ts
const id = `${venueId}:${key}`;
const requestHash = sha256(canonicalJson(validatedBody));   // sorted keys, no whitespace

try {
  await idempotency.insertOne({
    _id: id, venueId, key, requestHash,
    state: "in_flight", createdAt: now, expiresAt: new Date(+now + 86_400_000),
  });
  // claim won -> proceed to step 5 of the confirm sequence
} catch (err) {
  if (!(err instanceof MongoServerError && err.code === 11000)) throw err;
  // claim lost -> a record exists
  const existing = await idempotency.findOne({ _id: id });
  // ... resolution table below
}
```

The `insertOne` on `_id` is the claim. It is atomic, it needs no transaction, and it costs one write. This is why `_id` was chosen as the compound key rather than a secondary unique index. It stays **outside** the booking transaction: it has to happen before the booking documents can be built, and a claim that rolled back with a failed booking would let the same key be replayed into a second attempt.

`canonicalJson` sorts object keys recursively so that two orderings of the same object hash identically. Otherwise a client that serializes in a different key order gets a spurious 422.

The hash is computed over the **validated** body (post-Zod-parse), not the raw request bytes. Zod strips unknown keys and applies defaults, so hashing the parsed output means a retry differing only in whitespace or an ignored extra field is correctly treated as the same request.

### Resolution of a lost claim

| `existing` state | Condition | Response |
|---|---|---|
| any | `existing.requestHash !== requestHash` | **422 `IDEMPOTENCY_KEY_REUSED`.** The key is being reused for a different request. Do not execute, do not replay. |
| `in_flight` | `createdAt` newer than 60s | **409 `REQUEST_IN_FLIGHT`**, header `Retry-After: 1`. The original request is still running. Returning the eventual result would require blocking or polling; the honest answer is "ask again shortly". |
| `in_flight` | `createdAt` older than 60s | **Abandoned. Take it over.** See below. |
| `completed` | | **Replay.** Return `existing.statusCode` with `existing.response` verbatim, plus header `Idempotent-Replay: true`. |
| `failed` | | **Replay.** Same mechanism. A retry of a request that deterministically returned 409 `SLOT_TAKEN` gets the same 409, not a fresh attempt. |

### Retry of an in-flight request versus a completed one

- **In-flight:** 409 `REQUEST_IN_FLIGHT` with `Retry-After: 1`. Never a 201, never a partial result, never a block. Waiting for the in-flight request means holding an HTTP connection open on a Render free instance for an unbounded time, and long-polling a booking is not worth the machinery.
- **Completed:** the byte-identical original response and status code, plus `Idempotent-Replay: true`. The client cannot tell the difference except by that header, which is the point.
- **Same key, different body:** 422 `IDEMPOTENCY_KEY_REUSED`. Not 409, which is reserved for genuine cell conflicts, and not a silent replay, which would hand the client a response to a request it did not make.

The 60-second threshold now has a longer worst case to clear than in revision 1: a confirm can spend up to `timeoutMS` (8s) inside the transaction plus several round trips to Singapore. 60 seconds is still comfortably longer than any legitimate confirm. Do not raise it without also raising `timeoutMS`, and do not lower it below `timeoutMS + 10s`.

### Abandoned in-flight takeover

If the process is killed between claiming and finalizing, the record sits `in_flight` forever and the key is bricked for 24 hours. Guard:

```ts
const taken = await idempotency.updateOne(
  { _id: id, state: "in_flight", createdAt: { $lt: new Date(+now - 60_000) } },
  { $set: { createdAt: now } },
);
if (taken.modifiedCount === 1) { /* proceed */ }
else { /* 409 REQUEST_IN_FLIGHT */ }
```

The filter-and-set is a single atomic document update, so exactly one concurrent takeover attempt wins.

### Finalization, and the crash window that moving it closed

**Success:** `state: "completed"`, `statusCode: 201`, `response` set to the booking body, `bookingId` set. **This write happens inside the booking transaction** (section 4, step 10).

Revision 1 finalized after the insert, in a separate write. That left a real window. A crash between the booking insert and the finalize leaves a committed booking with an `in_flight` idempotency record. Sixty seconds later the takeover rule fires, the retry re-runs the confirm, and it races against **its own** already-committed claims. The client's retry gets 409 `SLOT_TAKEN` for a booking that is theirs and that they were never told about. That is the worst available outcome for a paying customer: the station is held, the money is owed, and the confirmation never arrives.

Putting the finalize in the transaction closes it. The booking, its claims, and the record saying "this key produced this response" become durable in the same commit. There is no instant at which one exists without the others. The cost is one extra write inside the transaction, which is one extra operation against the 100 ops/sec budget.

**Deterministic domain failure** (409 `SLOT_TAKEN`, 410 `HOLD_EXPIRED`, 404 `STATION_NOT_FOUND`, any 422): `state: "failed"` with that status and body, written **outside** the transaction, because the transaction aborted and there is nothing left to join. Replayable, because retrying would deterministically produce the same answer and re-running the work is pointless.

**Non-deterministic infrastructure failure** (Mongo unreachable, `MongoOperationTimeoutError`, unexpected 5xx): **`deleteOne({ _id: id })`**, then return the error. Deleting rather than recording a failure is deliberate: the request never reached a decision, so the client must be allowed to retry the same key and actually get a booking. Recording it as `failed` would permanently deny a booking because of a transient blip.

`MongoOperationTimeoutError` sits in this bucket rather than the deterministic one, and that creates the one residual hole in the design. The transaction may have committed server-side while the client-side deadline fired. If it did, the retry finds the idempotency record gone but the claims present, and returns 409 `SLOT_TAKEN` for the user's own booking. It is called out here rather than papered over. Mitigation if it ever shows up in practice: before deleting the record on a timeout, read `bookings` by the pre-generated `bookingDoc._id`. If it exists, the transaction committed, so finalize as `completed` and return 201. That is five lines, deferred only because it needs a specific race to occur.

`// ponytail: timeout-then-commit is handled by deleting the idempotency record and letting the retry fail loudly; add the bookingId existence probe if this is ever observed in a log.`

If the `deleteOne` itself fails, the record stays `in_flight` and the 60-second takeover rule catches it. Layered, no orphan state.

---

## 6. API contract

All new routes under `/v1`. Existing `GET /health` stays where it is, unversioned, because Render's health check points at it and an external keepalive ping already targets it.

Schemas live in `packages/types/src/api/` (network contracts) and `packages/types/src/common/` (domain shapes reused by the engine), per the existing rule in `packages/types/README.md`. Each file exports the schema and its inferred type side by side, matching the `healthResponseSchema` / `HealthResponse` pattern already in the repo.

Files to add under `packages/types/src/`:

- `common/cell.ts`: `cellStateSchema`, `availabilityCellSchema`, `CellState`, `AvailabilityCell`
- `common/error.ts`: `errorCodeSchema`, `apiErrorSchema`, `ApiError`
- `common/station.ts`: `stationKindSchema`, `stationSummarySchema`, `StationKind`, `StationSummary`
- `api/venue.ts`: `venueResponseSchema`, `VenueResponse`
- `api/availability.ts`: `availabilityQuerySchema`, `availabilityResponseSchema`
- `api/hold.ts`: `createHoldRequestSchema`, `createHoldResponseSchema`, `releaseHoldRequestSchema`
- `api/booking.ts`: `createBookingRequestSchema`, `bookingResponseSchema`, `getBookingQuerySchema`, `cancelBookingRequestSchema`

`apps/api` parses every request with these schemas at the route boundary. `apps/web` (milestone 3) imports the same objects. No shape is redefined in either app.

Shared primitives, defined once in `common/`:

```ts
export const objectIdSchema  = z.string().regex(/^[0-9a-f]{24}$/);
export const isoInstantSchema = z.string().datetime({ offset: false });  // must end in Z
export const localDateSchema  = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
```

`isoInstantSchema` requiring a literal `Z` is deliberate: it removes any chance of a client sending `2026-11-01T01:30:00-04:00` versus `-05:00` and the server having to guess which of the two fall-back instants was meant. The identity is a UTC instant, so the wire format is UTC.

---

### `GET /health`

Unchanged. 200 only.

---

### `GET /v1/venues/:venueSlug`

Public venue configuration, so the client can render a date picker and a station list without guessing.

**Path:** `venueSlug`, `z.string().min(1).max(64).regex(/^[a-z0-9-]+$/)`

**Response 200:**

```ts
{
  id: string,              // ObjectId hex
  slug: string,
  name: string,
  timezone: string,        // IANA
  gridMinutes: number,     // 30
  bufferMinutes: number,
  currency: string,        // "INR"
  openingHours: Record<"0".."6", { open: string, close: string } | null>,
  blackoutDates: string[],
  leadTimeMinutes: number,
  maxAdvanceDays: number,
  stations: {
    id: string,
    slug: string,
    name: string,
    kind: "ps5" | "ps3" | "ps2" | "racing-sim",
    capacity: number,        // max partySize
    hourlyRateMinor: number, // integer minor units of `currency`
    minSlots: number,
    maxSlots: number
  }[]                        // active only
}
```

The station list carries `capacity`, `hourlyRateMinor`, `minSlots`, and `maxSlots` because a client needs all four to build a booking form: how many people fit, what it costs per hour, and what durations are offered. Sending them here rather than repeating them on every availability cell keeps the availability payload to identity and state.

`openingHours` entries where `close <= open` mean the session runs past local midnight. The client should render that as "14:00 to 02:00" rather than as an error, and should understand that `?date=D` returns the session that opens on `D`.

**Statuses:** `200`, `400` (malformed slug), `404` `VENUE_NOT_FOUND`, `500`.

---

### `GET /v1/venues/:venueSlug/availability`

**Query:** `date` (required, `localDateSchema`, the **business date**, the date the session opens on), `stationId` (optional, `objectIdSchema`), `kind` (optional, `stationKindSchema`).

**Response 200:**

```ts
{
  businessDate: string,
  timezone: string,
  gridMinutes: number,     // 30
  closed: null | { reason: "weekday_closed" | "blackout" | "no_valid_hours" },
  degraded: boolean,       // true when Redis was unreachable; held cells are reported as free
  cells: {
    stationId: string,
    startsAt: string,      // ISO UTC with Z -- THE IDENTITY, send this back verbatim
    endsAt: string,        // startsAt + gridMinutes
    localLabel: string,    // "2026-08-08 01:30 IST" -- display only, never sent back
    state: "free" | "held" | "booked" | "maintenance" | "past" | "too_far_ahead"
  }[]
}
```

Server work: resolve venue, `generateSlotGrid` to get the cells and `windowStartMs`/`windowEndMs`, `find` active stations, `find` confirmed `slot_claims` in the UTC window (covered query, see section 1), `SCAN` Redis holds for the venue, `computeAvailability`, serialize.

**Cells whose local date is the day after `businessDate` are included when the session crosses midnight**, and their `localLabel` shows that later date. This is not a bug and clients must not filter on the label. Section 2 has the rule and the justification.

**To book a range**, a client picks a `startsAt` and a `slotCount`, and checks that the `slotCount` consecutive cells starting there on that station are all `free`. Consecutive means adjacent in the returned array for that station, not `startsAt + n * gridMinutes`: on a fall-back night two cells one hour apart in real time carry the same local label, and on a spring-forward night the arithmetic skips an hour. The array order is the truth. The server revalidates the whole range at confirm, so a client that gets this wrong receives a clean 409 or 422 rather than a bad booking.

**Statuses:** `200`, `400` `VALIDATION_FAILED` (missing or malformed `date`), `404` `VENUE_NOT_FOUND`, `422` `DATE_OUT_OF_RANGE` (beyond `maxAdvanceDays`, or in the past by more than one day), `500`.

Unbounded-list note: bounded by construction. One session times 15 stations times at most 48 cells is at most 720 rows. No pagination, and none is needed. Ceiling: a venue with 200 stations and a 5-minute grid would return ~57k rows. Upgrade path: require `stationId` or `kind` above some station count, or paginate by station.

`// ponytail: unpaginated because one session x tens of stations is bounded; add station pagination above ~50 stations.`

---

### `POST /v1/venues/:venueSlug/holds`

**Request:**

```ts
{ stationId: string, startsAt: string, slotCount: number }   // objectId, isoInstant, int 1..48
```

`slotCount` is new. A hold covers the whole range the client intends to book, because holding only the first cell would let another client take the middle of a 3-cell range while the first client is still typing.

**Response 201:**

```ts
{
  holdId: string,
  stationId: string,
  startsAt: string,
  endsAt: string,          // startsAt + slotCount * gridMinutes
  slotCount: number,
  expiresAt: string,
  ttlSeconds: number,
  quoteMinor: number,      // integer minor units, what this booking will cost
  currency: string
}
```

`quoteMinor` is returned so the client can show a price before the customer commits, computed by the same `priceBooking` the confirm path uses. It is informational. The confirm recomputes it and the confirm's value is authoritative. A client never sends a price.

**Statuses:**

| Code | Meaning |
|---|---|
| `201` | Hold acquired on every cell in the range |
| `400` | `VALIDATION_FAILED` |
| `404` | `VENUE_NOT_FOUND` / `STATION_NOT_FOUND` |
| `409` | `SLOT_HELD`: another client holds at least one cell in the range (acquire script returned 0) |
| `409` | `SLOT_TAKEN`: at least one cell is already confirmed in Mongo |
| `409` | `SLOT_UNAVAILABLE`: at least one cell is inside a maintenance window |
| `422` | `SLOT_NOT_ON_GRID`: `startsAt` is not a legal cell boundary for this venue |
| `422` | `SLOT_COUNT_OUT_OF_RANGE`: outside this station's `minSlots` to `maxSlots` |
| `422` | `SLOT_OUT_OF_WINDOW`: before `now + leadTime`, beyond `maxAdvanceDays`, or the range would extend past closing |
| `503` | `HOLD_UNAVAILABLE`: Redis unreachable. Body carries a hint to confirm without a `holdId`. This endpoint is the one place a Redis outage is visible as a failure, because a hold is definitionally a Redis object. Confirm still works. |
| `500` | |

There is no `PARTY_SIZE_EXCEEDS_CAPACITY` here. A hold does not carry a party size, because party size does not affect what is held.

---

### `POST /v1/venues/:venueSlug/holds/release`

POST rather than `DELETE /holds/:holdId` because releasing needs `stationId`, `startsAt`, and `slotCount` to reconstruct the Redis keys, and `DELETE` with a request body has patchy client and proxy support. The alternative, a reverse holdId-to-range key in Redis, is a second key to write, expire, and keep consistent for no benefit. Not REST-pretty, stated plainly rather than papered over.

**Request:** `{ holdId: string, stationId: string, startsAt: string, slotCount: number }`. The client already has all four from the hold response.

**Response 204**, no body, whether the compare-and-delete matched every cell, some, or none. "I am not holding this" is true either way.

**Statuses:** `204`, `400` `VALIDATION_FAILED`, `404` `VENUE_NOT_FOUND`, `503` `HOLD_UNAVAILABLE` (Redis down; the hold expires on its own within the TTL, so this is informational), `500`.

---

### `POST /v1/venues/:venueSlug/bookings`

**Headers:** `Idempotency-Key` (required). `Content-Type: application/json`.

**Request:**

```ts
{
  stationId: string,       // objectIdSchema
  startsAt: string,        // isoInstantSchema, must be a grid cell start
  slotCount: number,       // int, Zod bound 1..48, station bound minSlots..maxSlots
  partySize: number,       // int, Zod bound 1..8, station bound 1..capacity
  holdId?: string,         // uuid; optional -- absence is legal, see section 4
  player: {
    name: string,          // 1..80, trimmed
    email?: string,        // z.string().email()
    phone?: string         // 5..32, /^[+0-9 ()-]+$/
  }
}
```

No price field. The server computes `totalMinor`, and a client-supplied value would be ignored, so accepting one would only invite confusion about which was used.

The Zod bounds on `slotCount` and `partySize` are static outer limits that stop absurd input before a database read. The real bounds are per station and are checked in step 6 of the confirm sequence.

**Response 201:**

```ts
{
  id: string,
  venueId: string,
  stationId: string,
  stationName: string,
  stationKind: "ps5" | "ps3" | "ps2" | "racing-sim",
  startsAt: string,
  endsAt: string,
  slotCount: number,
  partySize: number,
  localLabel: string,      // label of the first cell
  status: "confirmed" | "cancelled",
  confirmationCode: string,
  totalMinor: number,
  currency: string,
  player: { name: string, email?: string, phone?: string },
  createdAt: string,
  cancelledAt: string | null
}
```

**Response headers:** `Idempotent-Replay: true`, present only on a replayed response.

**Statuses, complete:**

| Code | Error code | Cause |
|---|---|---|
| `201` | | Booked, or a replay of a previously successful booking |
| `400` | `VALIDATION_FAILED` | Zod rejected the body |
| `400` | `IDEMPOTENCY_KEY_REQUIRED` | Header absent |
| `404` | `VENUE_NOT_FOUND` | Unknown slug |
| `404` | `STATION_NOT_FOUND` | Station absent, retired, or belongs to another venue |
| `409` | `SLOT_TAKEN` | 11000 on `uniq_slot_claim`, or a pre-check found a confirmed claim in the range |
| `409` | `SLOT_HELD` | `holdId` supplied but Redis holds a different value on at least one cell |
| `409` | `SLOT_UNAVAILABLE` | Maintenance window overlaps the range |
| `409` | `REQUEST_IN_FLIGHT` | Same idempotency key currently executing. `Retry-After: 1` |
| `410` | `HOLD_EXPIRED` | `holdId` supplied, Redis reachable, at least one cell key gone and none foreign |
| `422` | `IDEMPOTENCY_KEY_REUSED` | Same key, different `requestHash` |
| `422` | `SLOT_NOT_ON_GRID` | `startsAt` is not a legal cell boundary for this venue |
| `422` | `SLOT_OUT_OF_WINDOW` | Violates `leadTimeMinutes` or `maxAdvanceDays`, or the range extends past closing |
| `422` | `SLOT_COUNT_OUT_OF_RANGE` | Outside this station's `minSlots` to `maxSlots` |
| `422` | `PARTY_SIZE_EXCEEDS_CAPACITY` | `partySize > station.capacity` |
| `503` | `BOOKING_TIMEOUT` | Transaction retry budget exhausted. `Retry-After: 2`. Idempotency record deleted so a retry is permitted |
| `500` | `INTERNAL` | Anything else. Idempotency record deleted so a retry is permitted |

`404` for a station in the wrong venue rather than `403`: with no auth, a `403` would leak that the station exists somewhere. Tenant isolation means cross-tenant references are indistinguishable from nonexistent ones.

---

### `GET /v1/venues/:venueSlug/bookings/:bookingId`

**Query:** `code` (required), the `confirmationCode`.

The code is the authorization. With no accounts, an ObjectId alone is guessable enough to be uncomfortable and is enumerable in creation order. Requiring the code means the URL in a confirmation message works and a scraped id alone does not.

**Response 200:** same shape as the 201 above, including `status: "cancelled"` and a non-null `cancelledAt` for a cancelled booking.

**Statuses:** `200`, `400` `VALIDATION_FAILED` (missing `code`), `404` `BOOKING_NOT_FOUND` (wrong id, wrong code, or wrong venue, all indistinguishable and deliberately so), `500`.

Lookup filter is `{ _id, venueId, confirmationCode }`. All three. Never `{ _id }` alone.

---

### `POST /v1/venues/:venueSlug/bookings/:bookingId/cancel`

**Request:** `{ confirmationCode: string }`. In the body, not the query string, so it stays out of access logs and `Referer` headers. Section 4 has the full sequence and the rationale.

**Response 200:** the booking, with `status: "cancelled"` and `cancelledAt` set. Same shape as the read.

**Statuses:**

| Code | Error code | Cause |
|---|---|---|
| `200` | | Cancelled, **or already cancelled**. Idempotent by design. |
| `400` | `VALIDATION_FAILED` | Missing or malformed `confirmationCode` or `bookingId` |
| `404` | `BOOKING_NOT_FOUND` | Wrong id, wrong code, or wrong venue |
| `422` | `BOOKING_NOT_CANCELLABLE` | `now >= startsAt`: the session has started or finished |
| `503` | `BOOKING_TIMEOUT` | Transaction retry budget exhausted. Safe to retry, since cancel is idempotent |
| `500` | `INTERNAL` | |

No `Idempotency-Key`. The operation is idempotent by construction, so the header would add a failure mode without adding a guarantee.

---

### Cross-cutting middleware, in order

1. `express.json({ limit: "16kb" })`. **Not currently present in `server.ts`, must be added.** The 16kb cap is the cheap request-size trust boundary.
2. `cors({ origin: env.WEB_ORIGIN })`. Already present, unchanged.
3. Request id: `crypto.randomUUID()` onto `req.locals.requestId`, echoed in the `X-Request-Id` response header and inside every error body.
4. Venue resolution: `apps/api/src/middleware/venue.ts` mounted on `/v1/venues/:venueSlug`. Resolves the slug to a venue document once, attaches it, 404s if absent. **Every downstream handler reads `venueId` from here, never from the request body or query.** This is the single tenant-resolution point.
5. Rate limit on `POST /holds`, `POST /bookings`, and `POST /bookings/:id/cancel`: an in-memory fixed-window counter keyed by `${venueId}:${req.ip}`, 30 requests per minute, 429 `RATE_LIMITED` with `Retry-After`. Roughly 25 lines using a `Map` plus a periodic sweep. No dependency. Anonymous unauthenticated writes with zero throttling would let one script exhaust every station in a venue, which is a real denial of service against a physical business. Cancel is included because a script guessing confirmation codes is a second, nastier abuse path, and the rate limit is the only thing between it and a 2^50 search space.
6. 404 handler.
7. Error handler, 4 params, registered last. Express 5 auto-forwards rejected promises here (verified against the framework's own tests), so no route needs a try/catch wrapper.

`// ponytail: in-memory rate limit; per-instance only, so it does not hold across a multi-instance deploy. Move the counter to Redis (INCR + EXPIRE) when the API scales past one instance.`

---

## 7. Error model

One shape, every failure, no exceptions.

```ts
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,           // z.enum([...]) -- closed set, shared with the client
    message: z.string(),             // human-readable, safe to display
    details: z.unknown().optional(), // only populated for VALIDATION_FAILED and SLOT_TAKEN
    requestId: z.string(),           // matches the X-Request-Id header
  }),
});
```

`code` is a Zod enum rather than a free string, so `apps/web` gets an exhaustive union and the compiler catches an unhandled case when a new code is added. `message` is for humans, `code` is for machines. Clients branch on `code`.

For `VALIDATION_FAILED`, `details` is `zodError.flatten()` (Zod 3 API, matching the existing usage in `env.ts`). For `SLOT_TAKEN`, `details` may carry `conflictingCellStart` when the driver supplied it. For every other code, `details` is omitted. Internal errors never leak a stack, a Mongo error message, or a driver error.

### Implementation

One class, in `apps/api/src/errors.ts`:

```ts
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) { super(message); }
}
```

Routes `throw new DomainError(...)`. Express 5 forwards it. The error handler serializes it. No error subclass hierarchy, no error factory, no `Result` type. `headers` exists so `REQUEST_IN_FLIGHT`, `RATE_LIMITED`, and `BOOKING_TIMEOUT` can attach `Retry-After` without a special case in the handler.

### Domain failure mapping

| Domain failure | `code` | HTTP | Where it is raised | Client should |
|---|---|---|---|---|
| A cell in the range was just claimed | `SLOT_TAKEN` | 409 | 11000 on `uniq_slot_claim`, and the pre-check in hold and confirm | Refetch availability, pick another range |
| A cell in the range is held by someone else | `SLOT_HELD` | 409 | Acquire script returned 0, or confirm's `MGET` found a foreign value | Refetch availability, retry shortly |
| Hold expired | `HOLD_EXPIRED` | 410 | Confirm, `holdId` given, Redis up, at least one key absent | Re-acquire a hold, then confirm again |
| Venue unknown | `VENUE_NOT_FOUND` | 404 | Venue middleware | Fix the URL |
| Station unknown, retired, or cross-tenant | `STATION_NOT_FOUND` | 404 | Confirm step 5, hold | Refetch the venue |
| Party larger than the station seats | `PARTY_SIZE_EXCEEDS_CAPACITY` | 422 | Confirm step 6 | Pick a bigger station or split the group across two bookings |
| Duration outside this station's limits | `SLOT_COUNT_OUT_OF_RANGE` | 422 | Confirm step 6, hold | Pick a legal duration; the limits are in the venue response |
| Idempotency key reused with a different body | `IDEMPOTENCY_KEY_REUSED` | 422 | Idempotency claim, hash mismatch | Bug in the client; generate a fresh key |
| Same key still executing | `REQUEST_IN_FLIGHT` | 409 + `Retry-After: 1` | Idempotency claim, state `in_flight`, fresh | Retry the same key after the delay |
| Idempotency header absent | `IDEMPOTENCY_KEY_REQUIRED` | 400 | Confirm entry | Bug in the client |
| `startsAt` is not a cell boundary | `SLOT_NOT_ON_GRID` | 422 | Grid validation | Refetch availability; do not construct timestamps client-side |
| Outside lead time, max advance, or past closing | `SLOT_OUT_OF_WINDOW` | 422 | Grid validation | Pick another range |
| Maintenance window | `SLOT_UNAVAILABLE` | 409 | Grid validation | Pick another station or time |
| Requested date beyond the bookable range | `DATE_OUT_OF_RANGE` | 422 | Availability query validation | Pick another date |
| Booking already started or finished | `BOOKING_NOT_CANCELLABLE` | 422 | Cancel step 4 | Nothing; call the venue |
| Redis unreachable on a hold request | `HOLD_UNAVAILABLE` | 503 | Hold routes only | Confirm without a `holdId` |
| Transaction retry budget exhausted | `BOOKING_TIMEOUT` | 503 + `Retry-After: 2` | Confirm and cancel | Retry with the same idempotency key |
| Schema violation | `VALIDATION_FAILED` | 400 | Zod parse, any route | Fix the request |
| Too many requests | `RATE_LIMITED` | 429 + `Retry-After` | Rate-limit middleware | Back off |
| Booking not found or wrong code | `BOOKING_NOT_FOUND` | 404 | Booking read, cancel | Check the link |
| Anything unexpected | `INTERNAL` | 500 | Error handler fallback | Retry with the same idempotency key |

Three distinctions that matter most:

- **`SLOT_TAKEN` (409, permanent, someone else owns it) versus `HOLD_EXPIRED` (410, recoverable, the range may still be free).** Collapsing them leaves the client unable to tell "try again" from "give up".
- **`SLOT_TAKEN` (409, someone else won) versus `BOOKING_TIMEOUT` (503, we do not know who won).** Reporting a timeout as a conflict tells the user a specific falsehood about who has the station.
- **`PARTY_SIZE_EXCEEDS_CAPACITY` versus `SLOT_COUNT_OUT_OF_RANGE`.** Both are 422 on the same request and a client needs to know which field to fix.

---

## 8. Infrastructure: production and development

**Revision 1 recommended Docker Compose with `mongo:7` and `redis:7` for local development. That recommendation is withdrawn. There is no local database, and there is no `docker-compose.yml`.**

### The decided setup

| Piece | Where | Notes |
|---|---|---|
| MongoDB | **Atlas M0, Singapore (AWS `ap-southeast-1`)** | One cluster. Two databases: `playstop` (prod) and `playstop_dev` (dev and integration tests). |
| Redis | **Upstash, Singapore** | Two databases on the free tier: one prod, one dev. Free tier allows up to 10. |
| API | **Render free web service, Singapore** | `render.yaml` gains `region: singapore` and three `sync: false` env vars. |
| Web | Cloudflare Pages | Unchanged from milestone 1. |
| CI | GitHub Actions | Its own throwaway Mongo replica set and Redis, see section 9. |

Everything sits in one region so the API's round trips to both stores are single-digit milliseconds in production. Developer round trips from outside Singapore are tens of milliseconds, which is the cost of the no-local-database decision and is priced in below.

### Environment variables

New in `apps/api/src/env.ts` and `apps/api/.env.example`:

```
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=playstop_dev
REDIS_URL=rediss://default:<token>@<endpoint>.upstash.io:6379
HOLD_TTL_SECONDS=300
APP_ENV=dev
```

Zod additions (v3 API, matching the existing file):

```ts
MONGODB_URI:      z.string().url(),
MONGODB_DB:       z.string().min(1).max(38),      // Atlas caps database names at 38 bytes
REDIS_URL:        z.string().url(),
HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
APP_ENV:          z.enum(["dev", "prod"]),
```

**`MONGODB_DB` is a separate variable and is not read from the connection string path.** Two reasons. Putting it in the URI means the dev and prod URIs differ only by a substring buried in the middle of a long string, which is exactly the kind of difference that survives a copy-paste. And `mongodb+srv` URIs with a database path plus query parameters are easy to malform. A separate, validated, 38-byte-capped variable makes the prod/dev choice visible in the Render dashboard as its own row.

No defaults on `MONGODB_URI` or `REDIS_URL`. An API that silently boots against nothing is worse than one that refuses to start, and the existing `env.ts` already establishes fail-fast-on-boot as the convention.

`APP_ENV` drives the Redis key prefix in section 4. It is separate from `NODE_ENV` because `NODE_ENV` is `development` on a developer machine talking to the shared dev database, and the key prefix has to describe the **data** environment, not the process mode.

`render.yaml` adds `region: singapore` and `MONGODB_URI`, `MONGODB_DB`, `REDIS_URL`, `APP_ENV` as `sync: false` so Render prompts rather than guesses, matching how `WEB_ORIGIN` is already handled. `HOLD_TTL_SECONDS` can carry a literal `300`.

### Atlas user scoping: how dev credentials are prevented from reaching prod

This is the part that is easy to get wrong, because the Atlas quickstart flow actively steers you into getting it wrong.

The default "Add New Database User" flow offers a built-in role labelled **"Read and write to any database"**, which is `readWriteAnyDatabase`. **Do not use it for either user.** A dev credential with that role can drop the production database, and it will be sitting in a `.env` file on a laptop.

Create two users under Database Access, each with **Specific Privileges** rather than a built-in role:

| User | Privilege | Used by |
|---|---|---|
| `playstop_dev_rw` | `readWrite` on database `playstop_dev` | Developer machines, and the low-volume integration tests |
| `playstop_prod_rw` | `readWrite` on database `playstop` | Render only |

In the Atlas UI: Database Access, Add New Database User, Password, then under "Database User Privileges" choose "Specific Privileges", pick the built-in role `readWrite`, and type the database name in the adjacent field. Leave the collection field empty so it applies to every collection in that database. Repeat for the second user with the other database name.

Result: the dev credential authenticates successfully but every operation against `playstop` fails authorization. Not "should not", **cannot**. The failure is a clean `not authorized on playstop to execute command`, which is unmistakable in a log.

Two things this does **not** protect against, stated so nobody assumes otherwise:

- **Both users share one cluster.** A dev workload that saturates the 100 ops/sec throttle throttles production too, because the limit is per cluster. This is the main argument for eventually splitting into two clusters, and it is the reason the concurrency proof does not run against Atlas (section 9).
- **The 500-collection and 0.5 GB caps are cluster-wide.** Dev filling storage takes prod down with it. At four collections and a hand-seeded venue this is not a live risk, but it is a shared-fate relationship and worth knowing before a test starts generating data.

Network access: Atlas requires an IP allowlist. Render free instances do not have static outbound IPs, so the production entry has to be `0.0.0.0/0`. That is not great and it is not optional on this tier. The mitigation is that the credential is scoped to one database, the password is long and lives only in Render's env store, and there is no PII beyond a name and an optional phone number. Named as a real, accepted risk rather than glossed. Upgrade path: a paid Render instance with a static outbound IP, then narrow the allowlist to it.

### Atlas M0 constraints that shape the rest of this document

| Constraint | Value | What it forces |
|---|---|---|
| Operations per second | **100**, then throttling with a 1-second cooldown | The concurrency proof cannot run here (section 9). It is also the first production ceiling, since a confirm costs 5 to 8 ops. |
| Collections, all databases | **500** | Tests must not create collections per run. Four per database is fine forever. |
| Databases | 100 | Tests must not create a database per run either. |
| Storage | 0.5 GB | Cancelled claim rows accumulate; noted in section 4 as prunable. |
| Data transfer | 10 GB in and 10 GB out per rolling 7 days | Not a constraint at this scale. |
| Connections | 500 | One `MongoClient` with the default pool per Render instance. Do not create a client per request. |
| Auto-pause | **After 30 days with zero connections** | The Render keepalive ping to `/health` does not touch Mongo, so it does not prevent this on its own. Either the health check performs a cheap Mongo `ping`, or someone connects at least monthly. Choosing: **`/health` gets an optional shallow Mongo ping**, since it also makes the health check tell the truth about whether the API can actually serve. |
| In-memory sort | 32 MB, `allowDiskUse` ignored | No sorts in this design large enough to matter. |
| Restricted commands | `$currentOp`, `$planCacheStats`, `$listSessions` unavailable; `admin` inaccessible | Do not build diagnostics on them. `.explain("executionStats")` still works and is what section 1 requires. |
| Replica set | 3 nodes, fixed | This is what makes transactions possible. Section 0 item 2 has the caveat and the smoke test. |

### Upstash quota, and redoing the arithmetic revision 1 got wrong

**Revision 1 stated a 10,000 requests/day cap and reasoned from it.** That figure is stale. Upstash replaced the daily cap with **500,000 commands per month** on 12 March 2025. The free tier also gives 256 MB max data size, 10 GB bandwidth, a 10 MB max request size, and up to 10 free databases.

500,000 per month is about **16,400 per day**, a 64x increase over the number revision 1 budgeted against. Redoing the arithmetic:

| Operation | Redis commands | Notes |
|---|---|---|
| Availability request | `1 + ceil(liveKeys / 500)` for the `SCAN` | 2 in practice; the live hold keyspace is a few dozen keys with a 5-minute TTL |
| Acquire a hold | 1 | one `EVALSHA`, whatever `slotCount` is |
| Release a hold | 1 | one `EVALSHA` |
| Confirm | 1 (`MGET`) + 1 (release) | 2, and only when a `holdId` was supplied |
| Cancel | 0 | cancel does not touch Redis |

A realistic day for one lounge: 2,000 availability loads (4,000 commands), 150 holds (150), 100 confirms (200), 120 releases including abandonments (120). About **4,500 commands per day, roughly 135,000 per month, 27% of the allowance.** That leaves room for a 3x traffic increase before anything needs to change.

**Is `SCAN` still the right call under the corrected quota? Yes, and more clearly than before.**

Revision 1 chose `SCAN` and flagged the request cap as "the first thing to measure", which was reasonable under a 10,000/day budget where `SCAN` consumed 40% of the allowance. Under 500K/month the same `SCAN` consumes 27%, and the alternative it was weighed against (a per-venue-per-day Redis Set index) trades one `SCAN` for one `SADD` per hold plus one `SMEMBERS` per availability request plus an `MGET` to reconcile members whose individual hold keys have expired. That alternative is **more** commands per availability request, not fewer, plus a second data structure to keep consistent and an expiry-skew reconciliation to get right. It was never a quota optimization; it is a keyspace-size optimization, and the keyspace is not large.

So the decision is unchanged and the reason for it is now stronger. What did change is which constraint to watch: **the first thing to measure is no longer Upstash's request count, it is Atlas M0's 100 ops/sec.** The Redis budget has 3x headroom, and the Mongo budget is exceeded by roughly 15 concurrent confirms.

The `SCAN` ceiling is still a keyspace-size ceiling, unchanged from revision 1: `SCAN` walks the whole keyspace regardless of `MATCH`, so it becomes wrong somewhere north of a few thousand concurrent holds. Upgrade path remains the Set index, or moving holds into Mongo with a TTL index.

### Upstash feature dependency audit

Every Redis operation this design performs, checked against Upstash's documented compatibility (`/upstash/docs`, `redis/features/restapi.mdx` and `redis/overall/compatibility.mdx`). This audit is carried over from revision 1 and re-checked against the multi-cell scripts.

| Operation | Where used | Upstash support | Verified |
|---|---|---|---|
| `EVAL` / `EVALSHA` | Multi-cell hold acquire and release | **Supported.** Upstash documents both, over REST and over TCP | Yes, explicitly |
| `EXISTS` | Inside the acquire script | Supported (Generic commands) | Yes |
| `SET key value PX ms` | Inside the acquire script | Supported (String commands) | Yes |
| `GET` | Inside the release script | Supported | Yes |
| `DEL` | Inside the release script | Supported (Generic commands) | Yes |
| `MGET` | Confirm hold verification across N cells | Supported (String commands) | Yes |
| `SCAN ... MATCH ... COUNT` | Availability hold lookup | Supported (Generic commands) | Yes |
| TCP via `rediss://` with ioredis | Client transport | **Supported.** Upstash supports both native Redis TCP and HTTPS REST, and documents ioredis with a `rediss://` connection string | Yes, explicitly |

Note that `SET ... NX` no longer appears. The multi-cell acquire script uses `EXISTS` plus an unconditional `SET`, because the all-or-nothing check happens across every key before any write. Inside a Lua script that is atomic without `NX`, and `NX` on individual keys would reintroduce partial acquisition.

Features this design deliberately **does not** use, each of which Upstash restricts or omits:

- **`WATCH` / `UNWATCH` / `DISCARD`:** not supported over the REST API. This is why the release path uses a Lua script rather than optimistic locking with `WATCH`. Had the design reached for `WATCH`, it would have worked locally and failed in production, which is precisely the class of bug worth checking up front.
- **Blocking commands** (`BLPOP`, `BRPOP`, blocking `XREAD`): not supported. Not used. There is no queue and no worker in this milestone.
- **Pub/Sub:** supported over REST with caveats, unnecessary here. Availability is polled, not pushed.
- **Redis Cluster:** not supported. Not used. A single ioredis connection, never `Redis.Cluster`.
- **Keyspace notifications** for hold expiry: not relied upon. Expiry is passive and nothing observes it.
- **Connection commands beyond `PING` / `ECHO`:** not supported over REST. Do not call `CLIENT`, `SELECT`, or `SWAPDB`. In particular **do not use a numbered Redis database via `SELECT`**; the `env` and `venueId` prefixes in the key are the isolation mechanism, and separate Upstash databases are the environment boundary.

### Render

Free web service, Singapore, unchanged from milestone 1 except for the region and the new env vars. Render spins down a free service after **15 minutes** without inbound traffic (reduced from 30 in September 2025) and takes about a minute to spin back up. The mitigation is an external keepalive ping to `/health` and it is **already documented in the repo `README.md`** and already marked with a `ponytail:` comment in `server.ts`. Nothing new is required here beyond keeping the ping interval under 15 minutes and pointing it at a `/health` that now also pings Mongo, so the same ping keeps the Atlas cluster from auto-pausing.

750 free instance hours per workspace per calendar month. One always-warm service uses about 730, so the keepalive ping consumes essentially the entire free allowance. Adding a second free service in the same workspace would exceed it. Worth knowing before someone spins up a staging API.

### What developing without a local database actually costs

Stated plainly, because it is a real tradeoff and revision 1 argued the other way:

- **No offline work on anything that touches the database.** Engine work, which is the hard part of this milestone, stays pure and offline-capable. Route work does not.
- **Every database round trip crosses the public internet.** From India to Singapore that is roughly 40 to 70 ms. A confirm is a handful of round trips plus a majority-write commit, so expect 250 to 500 ms in development against maybe 20 ms in production. Slow enough to notice, not slow enough to block work.
- **Dev and prod share a cluster and therefore share the 100 ops/sec throttle.** A careless loop on a laptop can throttle production.
- **Nothing can be wiped freely.** Section 9 specifies the isolation strategy that replaces "drop the database".

What it buys, and why it is the right call anyway: dev runs against a real 3-node replica set with real transaction semantics, real majority write concern, and real network latency, none of which a single-node local `mongod` reproduces. For a milestone whose entire point is transactional correctness under concurrency, testing against the real topology is worth more than testing offline. Docker Desktop also stays off the dependency list, which milestone 1's README explicitly wanted.

### Failure modes introduced or changed by this revision

| Mode | Blast radius | Mitigation |
|---|---|---|
| Atlas M0 throttles at 100 ops/sec under a traffic spike | Requests queue, then time out. Looks exactly like a hung API. | `timeoutMS` on the transaction turns it into a clean 503 `BOOKING_TIMEOUT` instead of a hang. Watch the Atlas Opscounter metric, which is one of the four metrics M0 exposes. Upgrade to Flex is the fix, not code. |
| Transactions turn out to be unsupported on M0 | Total. Nothing can be booked. | Step 0 smoke test before any code. Fallback options in section 4. |
| `withTransaction` transient-retry loop under contention | One request hangs up to the retry ceiling | `timeoutMS: 8000` caps it. Without it the ceiling is 120 seconds. |
| Transaction committed but the client-side deadline fired | One customer's booking exists with no confirmation; their retry gets 409 | Documented in section 5 with a five-line probe as the fix if observed. Currently accepted. |
| Atlas cluster auto-pauses after 30 idle days | Total outage until manually resumed | `/health` performs a shallow Mongo ping, so the existing keepalive also keeps the cluster awake. |
| Dev workload throttles or fills the shared cluster | Production degrades | Concurrency proof runs in CI, not against Atlas. Integration tests are low-volume and single-concurrency. Named as the argument for a second cluster later. |
| Render `0.0.0.0/0` Atlas allowlist | An attacker with the connection string reaches the database from anywhere | Credential scoped to one database, long password stored only in Render, no PII beyond name and optional phone. Accepted, with a static-IP upgrade path. |
| Upstash unreachable | Holds fail with 503; availability shows optimistic `free`; confirms still work | The whole degradation design in section 4. Test C proves it. |
| Cancelled claim rows accumulate | Storage against a 0.5 GB cap | Bounded by human cancellation rate. Prunable with a dated `deleteMany`. |
| Both hold-acquire and confirm succeed but the release script fails | One range holds stale keys for up to `HOLD_TTL_SECONDS` | Release is fire-and-forget; the TTL is the backstop; availability reports the cell as `booked` anyway because `booked` outranks `held`. |

### Observability, minimum viable

Not a full SLO program, but the confirm path is now a transaction against a throttled shared tier and it needs to be legible when it misbehaves.

Structured JSON logs to stdout (Render captures stdout), one line per request, always carrying `requestId`. Never log the `confirmationCode`, the `Idempotency-Key`, `player.email`, or `player.phone`. The confirmation code is a credential.

Events worth a dedicated log line: `booking_confirmed` (with `slotCount`, `stationKind`, `totalMinor`, and the transaction duration), `booking_conflict` (`SLOT_TAKEN`, with how many transient retries preceded it), `booking_timeout`, `booking_cancelled`, `redis_degraded`, `idempotent_replay`, `takeover_claimed`.

The one number to watch first: **transient retry count per confirm.** It is the leading indicator for both contention and the 100 ops/sec throttle, and it is invisible unless it is counted, because `withTransaction` handles those retries silently. Instrument it by counting callback invocations inside the closure.

SLI candidates for when there is traffic to measure: confirm success rate excluding legitimate 409s, confirm p95 latency, availability p95 latency, and the fraction of requests served in `degraded: true` mode.

---

## 9. Test strategy

**Runner: `node --test`, Node's built-in test runner.** Stdlib, already available on Node 20+, zero new dependencies, and it is what `~/.claude/rules/lang/ts.md` names as the default. The repo compiles TypeScript to `dist/` and runs from there (`apps/api/package.json` `dev:serve` is `node --watch dist/server.js`), so tests compile the same way and run as `node --test dist/**/*.test.js`. No `tsx`, no `ts-node`, no Vitest, no Jest. One toolchain, the one already in the repo. Unchanged from revision 1.

Add to the root `package.json`: `"test": "pnpm -r run test"`. Add to CI alongside the existing `typecheck` / `lint` / `build`.

### The split, and why it exists

**The concurrency proof cannot run against Atlas M0.** Test A fires 50 concurrent confirms, twenty times over. Each confirm costs 5 to 8 database operations, so one run is roughly 5,000 to 8,000 operations arriving in a few seconds. Atlas M0 throttles at 100 operations per second and applies a 1-second cooldown, with queued operations waiting longer when the queue exceeds the rate limit.

The result would not be a slow test. It would be a test that fails, and **fails in a way indistinguishable from the bug it exists to detect**. A throttled request that times out mid-transaction produces a missing 201. So does a lost race. So does a genuinely broken unique index. The single assertion the entire milestone rests on would be reporting noise, and the natural response to a flaky correctness test is to weaken the assertion until it passes, which is the worst possible outcome.

There is a second reason: dev and prod share one M0 cluster, so a concurrency run on a developer's laptop throttles production for the duration.

| Where | What | Against |
|---|---|---|
| Developer machine | Engine unit tests (pure, no I/O) | Nothing. No network, no database. |
| Developer machine | Low-volume integration tests | Atlas `playstop_dev` plus the Upstash dev database |
| CI, every push | Full suite including the concurrency proof | GitHub Actions: Mongo replica set plus a Redis service container |

The engine tests are the fast loop and they cover the hard part: every DST case, every midnight-crossing case, the grid, the claim builder, pricing. They run in well under a second with no network. That is deliberate. Timezone bugs are pure-function bugs and should be caught by pure-function tests, and a developer with no internet can still do the difficult work.

### Layer 1: engine unit tests (pure, no I/O)

`packages/engine/tests/*.test.ts` (see section 0a: moved out of `src`). All 33 cases from section 2, plus the claim-builder cases and the pricing cases from section 3. No database, no network, no Docker. Run on a developer machine and in CI on every push.

### Layer 2: integration tests against the shared Atlas dev database

`apps/api/tests/**/*.test.ts` (see section 0a: moved out of `src`), excluding the concurrency files.

**Revision 1's isolation strategy (a fresh database per test file, dropped in `after()`) is not available.** Atlas M0 caps at 100 databases and 500 collections across the whole cluster, dropping a database another developer is using would be rude at best, and creating databases per run against a shared cluster is exactly how the collection cap gets hit by accident.

**The replacement: isolate by tenant, not by database.** Every test file seeds its own venue with a unique slug:

```ts
const slug = `test-${randomUUID().slice(0, 8)}`;
const { venueId, stationIds } = await seedVenue({ slug, timezone: "Asia/Kolkata", ... });
```

- All four collections are the fixed, boot-created ones. Nothing creates a collection. The 500-collection cap is never approached.
- Every query in the entire codebase already filters on `venueId`, which is the tenancy invariant this design enforces everywhere. Two test files with different venue ids cannot see each other's documents, **and if they ever could, that is a tenant-isolation bug worth failing on.** The test isolation strategy and the security property are the same property. Running the suite exercises it continuously.
- Teardown deletes by `venueId` across all four collections. Never `dropDatabase()`, never an unfiltered `deleteMany({})`. A helper `wipeVenue(venueId)` does it in one place so no test file can get it wrong.
- Redis keys carry the same `venueId` in their prefix (section 4), so teardown does one `SCAN` on `ps:dev:{venueId}:*` and deletes the matches.
- Leftovers from a crashed run are harmless: a stale test venue is a few dozen documents under a slug nobody queries. A weekly `deleteMany({ slug: /^test-/ })` housekeeping script is enough, and is not required for correctness.

Volume rules, so this layer stays inside the 100 ops/sec throttle:

- `--test-concurrency=1` at the file level.
- **No test in this layer fires more than 5 concurrent requests.** Anything that needs real contention belongs in layer 3.
- The concurrency files carry a guard so they cannot run here by accident:
  ```ts
  const CI_ONLY = process.env.TEST_PROFILE === "ci";
  test("A: N concurrent confirms yield exactly one booking", { skip: !CI_ONLY }, async (t) => { ... });
  ```
  A developer running `pnpm test` gets a skip, not a throttled cluster. CI sets `TEST_PROFILE=ci`.

The app is started via `app.listen(0)` on an ephemeral port and tests hit it with the global `fetch`. No supertest, no new dependency.

Coverage for this layer: the happy path (single-cell and multi-cell), every status code in the section 6 tables, the venue middleware 404, the cancel path including double-cancel and the `BOOKING_NOT_CANCELLABLE` cases, party-size and slot-count rejection, and one cross-tenant test asserting that a station id from venue B returns 404 under venue A's slug.

### Layer 3: the concurrency proof, CI only

This is the test that justifies the milestone. Everything above is table stakes.

#### CI environment

Mongo must be a **replica set**, because the tests exercise transactions and a standalone `mongod` rejects `startSession().withTransaction` outright. A plain `services:` container running `mongo:7` is a standalone and will not work. Two options, and the workflow uses the first:

**Option A, the action (chosen):**

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s --health-timeout 3s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: supercharge/mongodb-github-action@v1.12.0
        with:
          mongodb-version: "7.0"
          mongodb-replica-set: rs0
          mongodb-port: 27017
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm --filter @playstop/types build && pnpm --filter @playstop/engine build && pnpm --filter @playstop/api build
      - run: node scripts/assert-replica-set.mjs        # readiness + transaction smoke test
        env:
          MONGODB_URI: mongodb://localhost:27017/?replicaSet=rs0
      - run: pnpm test
        env:
          TEST_PROFILE: ci
          MONGODB_URI: mongodb://localhost:27017/?replicaSet=rs0
          MONGODB_DB: playstop_ci
          REDIS_URL: redis://localhost:6379
          APP_ENV: dev
```

Verified: `supercharge/mongodb-github-action` supports replica sets through the `mongodb-replica-set` input, and it runs as a **step**, not as a service container, which is why Mongo is not in the `services:` block while Redis is. Current version is 1.12.x.

**Two caveats found while verifying it, and both are handled by `scripts/assert-replica-set.mjs`:**

1. **The action's README never mentions transactions.** "Starts a replica set" and "transactions work" are not the same claim, and this document's whole design rests on the second. The script does not assume it.
2. **The action documents no way to wait for the replica set to be ready.** `rs.initiate()` returning is not the same as a primary having been elected, and the first test to connect can get `NotWritablePrimary`.

`scripts/assert-replica-set.mjs`, roughly 25 lines, run before the suite:

```
1. Connect. Poll hello() until `isWritablePrimary` is true, up to 30s, then fail loudly.
2. Assert setName === "rs0".
3. Open a session. In one transaction, insert one document into `t1` and one into `t2`. Commit.
4. Assert both documents are readable.
5. Open a second transaction, insert into `t1`, then abort. Assert nothing was written.
6. Drop both collections. Exit 0.
```

Step 3 and step 5 are the actual verification that transactions work, rather than an assumption that a replica set implies them. Step 1 is the readiness wait the action does not provide. If this script fails, the suite does not run and CI reports the real reason instead of a wall of confusing test failures. **This is the same script as the step 0 Atlas smoke test in section 0 item 2, pointed at a different `MONGODB_URI`.** One script, two environments, which is why it is a standalone file rather than a test.

**Option B, if the action is ever unavailable:** a raw `services:` container with `image: mongo:7`, `options: --entrypoint mongod ... --replSet rs0 --bind_ip_all`, followed by a step that runs `mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'`. More moving parts and the same readiness problem, so the action is preferred. The smoke-test script is required either way.

Redis in CI is a plain `redis:7-alpine` service container. It supports `EVAL`, `EVALSHA`, `MGET`, and `SCAN` natively, which is the whole surface this design uses, and section 8's audit is what guarantees the CI Redis and the production Upstash behave identically on that surface.

#### Test A: N concurrent confirms, exactly one booking

The one test the milestone rests on. Carried over from revision 1 with the assertions moved to `slot_claims`.

```
seed venue + 1 station
pick one grid cell S
fire N = 50 concurrent POST /bookings for (station, S, slotCount: 1)
  - 50 DISTINCT Idempotency-Keys (so idempotency cannot mask the race)
  - NO holdId in any request (so the Redis hold cannot mask the race)
  - Promise.allSettled over Array.from({ length: 50 })

assert responses.filter(r => r.status === 201).length === 1
assert responses.filter(r => r.status === 409 && code === "SLOT_TAKEN").length === 49
assert bookings.countDocuments({ venueId, stationId, startsAt: S, status: "confirmed" }) === 1
assert slotClaims.countDocuments({ venueId, stationId, cellStart: S, status: "confirmed" }) === 1

repeat the whole cycle 20 times with a fresh cell each iteration
```

**The two bolded conditions from revision 1 still hold and are still what make this a proof.** Distinct idempotency keys are required because identical keys would be deduplicated by the idempotency layer and the test would pass while proving nothing about the unique index. Omitting `holdId` is required because the Redis hold would serialize the requests and the test would pass while proving nothing about the backstop. **A concurrency test that runs through the happy path with holds proves the hold works, not that the system is correct when it does not.** Run it against the degraded path deliberately.

New assertion, and it is the one that catches a wrong `withTransaction` usage: **no response may be 503 `BOOKING_TIMEOUT`.** With 50 contenders on one cell, transient `WriteConflict` retries are expected. If `timeoutMS` is too low, or the callback rebuilds documents on retry, or the transaction holds more than it should, the timeout starts firing and the test says so instead of silently passing on 49 conflicts and one timeout.

The 20 iterations exist because a single round can pass on timing luck if the requests happen not to overlap. Twenty rounds of fifty makes consistent overlap near-certain while keeping runtime to a few seconds.

#### Test I: a partial multi-cell booking is impossible

New in this revision, and the reason the transaction exists.

```
seed venue + 1 station
pick three consecutive grid cells S1, S2, S3

step 1: book S2 alone (slotCount: 1). Assert 201.
step 2: attempt to book S1..S3 as one booking (startsAt: S1, slotCount: 3),
        distinct Idempotency-Key, no holdId.

assert the response is 409 SLOT_TAKEN
assert slotClaims.countDocuments({ venueId, stationId, cellStart: S1 }) === 0
assert slotClaims.countDocuments({ venueId, stationId, cellStart: S3 }) === 0
assert slotClaims.countDocuments({ venueId, stationId, cellStart: S2, status: "confirmed" }) === 1
assert bookings.countDocuments({ venueId, slotCount: 3 }) === 0
assert idempotency record for key2 has state "failed"
```

The middle cell is chosen on purpose. With `ordered: true` the driver writes S1 successfully, fails on S2, and never attempts S3. **If the transaction is missing or misconfigured, S1's claim survives the failure**, and the assertions on S1 and on `bookings` catch it. A test that lost the race on the *first* cell would pass even with no transaction at all, because nothing would have been written before the failure. This test is only meaningful because the conflict is in the middle.

Second variant, concurrent rather than sequential: fire 20 concurrent 3-cell bookings whose ranges pairwise overlap without coinciding (S1..S3, S2..S4, S3..S5, and so on). Assert that the surviving bookings have pairwise disjoint cell ranges, that the count of confirmed claims equals the sum of the survivors' `slotCount + bufferSlotCount`, and that no claim exists whose `bookingId` has no confirmed booking. This is the general form of the invariant and it catches partial writes the fixed-position variant would miss.

#### Tests B through H, updated

**Test B: N concurrent holds, sanity check.** 50 clients each acquire a hold on the same 2-cell range. Assert exactly one 201 and 49 responses of 409 `SLOT_HELD`, then the winner's confirm returns 201. Proves the acquire script, which is the UX layer. Updated from revision 1: multi-cell, asserting the script's all-or-nothing behavior rather than `SET NX`'s.

**Test B2: overlapping-range holds.** Client A holds cells 1 to 3, client B tries to hold cells 3 to 5. Assert B gets 409 `SLOT_HELD` and that **cells 4 and 5 are not held afterward**, proving the acquire script wrote nothing on failure. A naive loop of `SET NX` calls passes every other hold test and fails this one.

**Test C: Redis down, still correct.** Point `REDIS_URL` at a closed port, boot the app, run Test A. Assert exactly one 201, one booking, and one claim, and assert every availability response carries `degraded: true`. This is the explicit proof of "Redis is UX, Mongo is truth". Without it the claim is a comment.

**Test D: concurrent idempotent retries.** Fire 20 concurrent `POST /bookings` with the **same** key and the **same** body. Assert exactly one booking document and `slotCount` claims; every response is 201 (the winner, or a replay carrying `Idempotent-Replay: true`) or 409 `REQUEST_IN_FLIGHT`; **no response is 409 `SLOT_TAKEN`**, which would mean the idempotency layer let a duplicate reach the transaction.

**Test E: same key, different body.** Sequential. First request 201, second with a changed `player.name` returns 422 `IDEMPOTENCY_KEY_REUSED`. Then assert the first key's replay still returns the original booking.

**Test F: replay after completion.** Book, then re-send the identical request. Assert 201, `Idempotent-Replay: true`, byte-identical body, and still exactly one booking and `slotCount` claims. Updated to also assert the idempotency record's stored `response` matches the original body, which is what the in-transaction finalize now guarantees.

**Test G: hold expiry.** Boot with `HOLD_TTL_SECONDS=1`, acquire a 2-cell hold, wait 1.5s, confirm with the `holdId`. Assert 410 `HOLD_EXPIRED`. Then confirm again with no `holdId`. Assert 201. Proves the two halves of the section 4 decision table that are easiest to get wrong.

**Test H: release does not steal.** Client A acquires a hold; the keys are manually overwritten to simulate expiry then reacquisition by client B; client A calls release. Assert every one of client B's hold keys still exists. This is the test for the compare-and-delete script. A naive `DEL` loop passes every other test in this suite and fails this one.

#### New tests for this revision's other changes

**Test J: cancel frees the cells.** Book a 3-cell range. Assert availability shows those cells `booked`. Cancel with the confirmation code. Assert 200, `status: "cancelled"`, that every claim for that booking is `status: "cancelled"`, and that availability now shows those cells `free`. Then book the same range again with a fresh key and assert 201, which proves the partial index actually released the constraint rather than merely hiding the rows from one query.

**Test K: double cancel.** Cancel the same booking twice, sequentially. Assert both return 200 with `status: "cancelled"` and that `cancelledAt` is identical in both responses, proving the second call did not rewrite the record.

**Test K2: concurrent double cancel.** Fire 10 concurrent cancels for one booking. Assert every response is 200, that `cancelledAt` is identical across all ten bodies, and that the claim documents were updated exactly once.

**Test L: cancel authorization.** Cancel with a wrong code returns 404. Cancel a venue A booking under venue B's slug returns 404. Assert the booking is still `confirmed` after both.

**Test M: cancel window.** A booking whose `startsAt` is in the past returns 422 `BOOKING_NOT_CANCELLABLE` and stays `confirmed`. A booking currently in progress does the same.

**Test N: per-station limits.** `partySize` one above `station.capacity` returns 422 `PARTY_SIZE_EXCEEDS_CAPACITY`. `slotCount` one above `station.maxSlots` returns 422 `SLOT_COUNT_OUT_OF_RANGE`. `slotCount` one below `minSlots` does the same. Assert no booking and no claim were written in any case. Run against a racing sim (`maxSlots: 4`) and a PS5 (`maxSlots: 8`) so a hardcoded limit fails.

**Test O: midnight-crossing booking end to end.** Seed a venue open 14:00 to 02:00. Book a 2-cell range starting at local 01:00, which is the day after the business date. Assert 201, that availability for `D` shows those cells `booked`, and that availability for `D+1` does not include them at all.

**Test P: booking cannot extend past closing.** Attempt a 4-cell booking starting at the third-from-last cell of a session. Assert 422 `SLOT_OUT_OF_WINDOW` and that no claims were written.

### What would make me stop trusting the design

If Test A ever produces two 201s, or the confirmed claim count for one cell ever exceeds 1, the unique index is either missing or not being applied. Check that boot-time `createIndexes` actually ran and did not silently fail against an existing conflicting index.

If Test I ever leaves a claim on S1, the transaction is not doing what this document says it does, and every guarantee in section 4 is void.

Those two assertions are what the entire milestone rests on.

---

## 10. Build order

Each step is independently verifiable and depends only on those above it. A single executor can work straight down the list.

**Step 0. Provision, and prove transactions work.**
Create the Atlas M0 cluster in Singapore. Create the two databases and the two scoped database users per section 8, using Specific Privileges and **not** "Read and write to any database". Create the two Upstash databases in Singapore. Write `scripts/assert-replica-set.mjs` (section 9). Run it against `playstop_dev`.
**Done when:** the script exits 0 against Atlas, and a second run using the dev credential against `MONGODB_DB=playstop` fails with an authorization error. Paste both outputs.
**If the transaction assertion fails, stop.** Section 0 item 2 and section 4's fallback describe the options. Everything below assumes it passed.

**Step 1. Shared types.**
Add `packages/types/src/common/{cell,error,station}.ts` and `packages/types/src/api/{venue,availability,hold,booking}.ts` with every schema from section 6, each exporting its inferred type alongside. Wire the barrel files (`src/common/index.ts` and `src/api/index.ts` are currently absent and referenced by `src/index.ts`, so they must exist).
**Done when:** `pnpm --filter @playstop/types build` and `pnpm typecheck` both pass, and `dist/index.js` exports every named schema.

**Step 2. Engine grid, including midnight crossing and DST.**
Add `luxon`, `@types/luxon`, and `@playstop/types` to `packages/engine`. Implement `generateSlotGrid` per section 2, including the business-day rule, the `plus({ days: 1 })` roll, the 24-hour session cap, and the boundary disambiguation. Write cases 1 through 13 and 20 through 33 from section 2.
**Done when:** `node --test` in `packages/engine` passes all of them, specifically including both DST directions in both hemispheres and every midnight-crossing case. **This step is where the hard thinking lives. Do not proceed until it is green.**

**Step 3. Engine availability, claim builder, pricing.**
Implement `computeAvailability` with the exact state precedence, `buildClaimCells` per section 3, and `priceBooking`. Write cases 14 through 19 and 21, plus the claim-builder and pricing cases.
**Done when:** every engine test passes and `pnpm --filter @playstop/engine build` succeeds.

**Step 4. Infrastructure wiring.**
Extend `apps/api/src/env.ts` with `MONGODB_URI`, `MONGODB_DB`, `REDIS_URL`, `HOLD_TTL_SECONDS`, `APP_ENV`, and update `.env.example` and `render.yaml` (including `region: singapore`). Add `apps/api/src/db.ts` (Mongo client, typed collection accessors, boot-time `createIndexes` for all six indexes from section 1) and `apps/api/src/redis.ts` (ioredis with the exact options from section 4, both Lua scripts via `defineCommand` with a dynamic key count, and the `tryRedis` wrapper). Add the shallow Mongo ping to `/health`.
**Done when:** `pnpm dev:api` boots clean against `playstop_dev`, and `db.slot_claims.getIndexes()` shows `uniq_slot_claim` with `unique: true`, the key order `{venueId, cellStart, stationId}`, and the partial filter. **Verify that index by hand before writing a single route.** Also measure and record the p99 Redis command latency to Upstash, and retune `commandTimeout` from the measurement rather than from the number in section 4.

**Step 5. Seed script.**
`apps/api/src/seed.ts`, run as `pnpm --filter @playstop/api seed`. Inserts one venue in `Asia/Kolkata` open 14:00 to 02:00 (so the midnight-crossing path is exercised in manual testing, not only in unit tests) and 15 stations: 7 PS5, 3 PS3, 2 PS2, 3 racing sim, with per-kind `capacity`, `hourlyRateMinor`, `minSlots`, `maxSlots`. Validates `(hourlyRateMinor * gridMinutes) % 60 === 0` for every station and refuses to write if it fails. Idempotent: upsert on `slug`. A `--with-dst-venue` flag additionally seeds an `America/New_York` venue so DST can be poked at by hand.
**Done when:** running it twice leaves exactly one venue and 15 stations, and the DST venue appears only with the flag.

**Step 6. Middleware and error handling.**
`express.json({ limit: "16kb" })`, request-id middleware, `DomainError`, the 4-param error handler, the 404 handler, the venue-resolution middleware, and the in-memory rate limiter. Register in the section 6 order.
**Done when:** a request to an unknown route returns the standard error envelope with a `requestId` matching the `X-Request-Id` header, and an unknown venue slug returns 404 `VENUE_NOT_FOUND`.

**Step 7. Read endpoints.**
`GET /v1/venues/:venueSlug` and `GET /v1/venues/:venueSlug/availability`, wiring the engine to Mongo and the Redis `SCAN`.
**Done when:** availability against the seeded venue returns 24 cells per station for a normal night, the correct reduced and increased counts against the DST venue on the two transition dates, and cells whose local date is the following day for the midnight-crossing session. Then run `.explain("executionStats")` on the `slot_claims` window query and confirm `IXSCAN` on `uniq_slot_claim` with **`totalDocsExamined: 0`** (covered) and `totalKeysExamined` close to `nReturned`. Record the numbers.

**Step 8. Holds.**
`POST /holds` and `POST /holds/release`, both Lua scripts, multi-cell. Integration tests B, B2, G, H.
**Done when:** those four pass, including the release-does-not-steal test and the overlapping-range test.

**Step 9. Confirm, with the transaction.**
`POST /bookings` end to end: idempotency claim, station load, per-station validation, grid validation, claim-cell construction, hold verification, the single transaction (booking + claims + idempotency finalize), the 11000 catch with index-name disambiguation, the `MongoOperationTimeoutError` catch, the fire-and-forget hold release. Plus `GET /bookings/:id`.
**Done when:** every status code in the section 6 booking table is reachable and covered, and Test I passes locally at low volume. Instrument the transient-retry counter from section 8 while you are in here; it is three lines and it is invisible later.

**Step 10. Cancel.**
`POST /bookings/:bookingId/cancel`, transactional, per section 4. Tests J, K, K2, L, M.
**Done when:** those five pass, and Test J's re-book after cancel returns 201, which is the real proof the partial index frees the cell.

**Step 11. CI, then the concurrency proof.**
Add the GitHub Actions job from section 9 with the replica set action, the Redis service container, and `scripts/assert-replica-set.mjs` as a gating step. Then Tests A, C, D, E, F, I, N, O, P behind `TEST_PROFILE=ci`.
**Done when:** `assert-replica-set.mjs` passes in CI, Test A shows exactly one 201, 49 `SLOT_TAKEN`, and zero `BOOKING_TIMEOUT` across 20 consecutive iterations, Test C reproduces that with Redis unreachable, and Test I leaves no orphan claim. **Paste the actual runner output.** This is the gate for calling the milestone done.

**Step 12. Documentation.**
Update `apps/api/README.md` (endpoints, new env vars, no Docker, Atlas and Upstash setup), `docs/ARCHITECTURE.md` (Mongo and Redis are present, not planned; add the Singapore topology), `packages/engine/README.md` (no longer a placeholder), `packages/types/README.md` (new exports), and the root `CLAUDE.md` "Do NOT" list, which currently forbids exactly what this milestone builds and will otherwise mislead the next session. The root `README.md` "Out of scope for milestone 1" list needs the same treatment, and its Docker entry is now permanent rather than deferred.
**Done when:** `pnpm typecheck && pnpm lint && pnpm build && pnpm test` all pass and no doc still describes MongoDB and Redis as future work or mentions Docker as a milestone 2 dependency.

---

## 11. What is decided, what is still open, and what I would push back on

Revision 1's section 11 listed five assumptions and three scope arguments. Four of the assumptions have since been decided against, and two of the scope arguments have been acted on. This section reflects the current state rather than the state at the time revision 1 was written.

### Resolved since revision 1

| Revision 1 said | Now |
|---|---|
| Assumed one booking equals exactly one grid slot, and warned that variable duration would need `slot_claims` plus a transaction. | **Decided: variable duration, 1..N cells, `slot_claims`, one transaction.** The warning was accurate and the retrofit was done before step 1 rather than after step 9, which is what it recommended. |
| Assumed opening hours never cross midnight, and called a late-night venue "a very plausible real requirement". | **Decided: sessions may cross midnight.** Section 2 has the business-day rule and thirteen new tests. |
| Argued a cancel endpoint belongs in this milestone rather than the next. | **Decided: it is in this milestone.** Section 4 and section 6. The partial index revision 1 added specifically to make this cheap is what made it cheap. |
| Recommended Docker Compose locally. | **Withdrawn. No local database.** Atlas plus Upstash for dev and prod, split by database name and scoped credentials. |
| Quoted Upstash's free tier as 10,000 requests/day. | **Corrected to 500,000 commands/month.** The budget was recomputed and the `SCAN` decision was re-examined and kept. |
| Assumed the buffer is per-venue and constant, folded into the grid stride, and that this made the unique index a complete backstop. | **The stride mechanism is gone.** The buffer now occupies claim cells, and section 3 re-derives why the index is still a complete backstop. `bufferMinutes: 0` for this venue. |
| Assumed a coin-op arcade with cabinets. | **It is a gaming lounge with stations.** Party size is metadata validated against station capacity, not a scarcity axis. |
| Deferred station attributes with no position on where they live. | **Decided: on the station document. No `stationTypes` collection.** |

### Assumptions that still stand

1. **Maintenance windows are one-off absolute instants, not recurring.** An owner will eventually want "every Monday 09:00 to 10:00". That is a pure-engine change (expand a rule into windows before calling `computeAvailability`), so deferring is cheap. Do not build a recurrence engine now.
2. **One venue, seeded by hand.** The multi-tenant boundary is real from day one; the second venue is not.
3. **`Asia/Kolkata` for the seeded venue, with an optional `America/New_York` venue behind a seed flag** so DST is reachable by hand as well as in unit tests.
4. **A group needing more seats than one station provides books two stations as two separate bookings.** There is no atomic group booking across stations. Six people on two PS5s is two confirms, two confirmation codes, and two cancels. If one confirm succeeds and the other loses a race, the customer has half a booking and no way to express "both or neither". See the open questions below.

### Genuinely open

1. **No-shows are the real business problem, and cancellation makes them cheaper, not rarer.** Anonymous booking with no deposit means a no-show costs the customer nothing and costs the lounge a full session. Adding cancellation is correct and it also removes the last friction from booking speculatively. There is no answer here that is not a payment integration or a phone-number verification step, and both are out of scope. **This is the largest unresolved business risk in the design and it is not a technical one.** Whoever owns the product should decide between a deposit, an SMS confirmation, or accepting the loss, before launch rather than after the first bad Saturday.
2. **There is still no owner or admin view.** Cancellation helps exactly one person: whoever holds the confirmation code. Staff cannot see today's bookings, cannot cancel a no-show to free the station for a walk-in, and cannot block a station that broke an hour ago without a database edit. A read-only "today's schedule" page plus a staff cancel is probably the highest-value thing in milestone 3, and it needs auth, which is why it is not here.
3. **Pricing is flat hourly per station and nothing else.** No peak pricing, no weekday rate, no per-player pricing, no packages. `hourlyRateMinor` on the station is the whole model. Peak pricing in particular is a normal thing for this business and would mean a rate that varies by cell, which changes `priceBooking` from a multiplication to a sum over cells. That is a contained change (the price is already computed per booking from the cell list) but it is not free, and it should be decided before anyone builds a pricing UI.
4. **No group booking across stations, per assumption 4 above.** Making it atomic is not hard given the machinery now in place, since it is one transaction writing two bookings and both claim sets, but the customer-facing model (one confirmation code for two stations? two codes? what does cancelling half mean?) is undecided and that is the harder part.
5. **Atlas M0's 100 ops/sec is the production ceiling and nobody has measured how close the real workload runs to it.** A confirm costs 5 to 8 operations, so roughly 15 concurrent confirms saturates it. That is fine for a 15-station lounge on a normal evening and it is not obviously fine on a launch day or during a tournament. Instrument the Atlas Opscounter metric from day one and decide the Flex upgrade trigger before it is needed rather than during an outage.
6. **Whether `bufferMinutes` should ever be non-zero for this venue.** Set to 0 on the reasoning in section 3. If staff report that changeovers actually run into the next session's first ten minutes, the mechanism exists and the cost is one full cell, which is a real revenue decision rather than a technical one.

### Two things I would push back on if asked

- **The `SCAN`-based hold lookup remains the one place with a knowingly low ceiling.** Right for one venue with 15 stations, wrong at a thousand concurrent holds. The corrected Upstash quota makes it more comfortable, not unbounded. The ceiling and the upgrade path are both in section 4. Do not let it silently outlive its assumptions.
- **Storing maintenance windows as absolute instants will feel wrong the first time an owner wants a weekly slot.** That is a pure-engine change, so the cost of deferring is genuinely low. Deferring is correct. Do not build the recurrence engine now.

### One thing to write down for whoever adds auth

Tenant identity currently comes from a client-supplied URL slug, which is safe only because there is no auth and all venue data is public. **The moment sessions exist, tenant identity must come from the session and the URL slug must be validated against it, not trusted.** The same applies to the confirmation code: it is currently both the identifier and the credential for reading and cancelling a booking, and once accounts exist that role should move to the session, with the code demoted to a human-readable reference.

Revision 1 made this point about the tenant slug and it is repeated here verbatim because it is now more load-bearing: the cancel endpoint means a client-supplied string can now destroy state, not just read it.
