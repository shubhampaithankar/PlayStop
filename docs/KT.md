# PlayStop, knowledge transfer

Self-serve slot booking for a physical gaming lounge. Players rent a PS5, PS3, PS2, or racing
sim by the half hour. The scarcity is physical, so a double booking means two groups turn up for
one console. That single fact drives most of the design below.

Live: web on Cloudflare Pages, API on Render. Booking needs a one-time code, which is mocked in
this deployment (the code shows on screen), so recruiters can complete a booking end to end.

## Stack

- TypeScript 5, strict, `exactOptionalPropertyTypes` on everywhere. Node >= 20.
- pnpm workspace monorepo, four packages. Hoisted node linker (`.npmrc`).
- Web: Vite + React 19 + Tailwind CSS v4 + shadcn/ui, TanStack Router + Query.
- API: Express 5 + Zod, MongoDB (native driver, no ODM) + Redis (ioredis).
- Data: MongoDB Atlas M0 and Upstash Redis, both Singapore. No local database, no Docker.

## Packages

- `packages/types`: hand-written unions and Mongo document shapes. Zero dependencies. Each
  enum-like value is one keyed const object with the union derived from it, declared once.
- `packages/engine`: everything with runtime behavior. Zod contracts (the wire schemas), the
  types inferred from them, and the pure logic: slot grid, availability, pricing. Depends on
  `zod`, `luxon`, `types`.
- `apps/api`: the booking API. `route -> controller -> data` per module, one folder per resource.
- `apps/web`: the player-facing flow, console to confirmation code.

Dependency direction only ever points from an app or the engine toward `types`, never back.
Any shape that crosses the network is a Zod schema in `packages/engine/src/contracts`, imported
on both sides, never redefined.

## How correctness works

The one backstop is a partial unique index, `uniq_slot_claim` on `(venueId, cellStart, stationId)`.
Everything else follows from it.

- **A booking is all its cells or none.** A booking spans one or more 30-minute cells. The
  booking document and one `slot_claims` row per cell are written in a single Mongo transaction,
  so losing the race on any one cell leaves nothing behind. The proof conflicts on the middle
  cell, since a first-cell conflict would pass even without a transaction.
- **Redis holds are UX, Mongo is truth.** A hold is an advisory soft reservation with a TTL. It
  is not proof a cell is free. Redis going down degrades the experience (more users see a
  conflict after clicking confirm) and never blocks a booking. Availability reports
  `degraded: true` and shows held cells as free rather than refusing to book.
- **OTP is a required, Redis-backed gate**, and unlike a hold it does not degrade open. A Redis
  outage blocks new bookings rather than letting an unverified one through. Deliberate tradeoff:
  a real dependency in exchange for every booking tracing to a verified email or phone.
- **Never trust a client instant.** `startsAt` is validated against the server grid first, so a
  client cannot book at 14:07 and slip between cells.
- **Idempotency.** The confirm key is bound to a hash of the validated body. The client mints it
  once per attempt and reuses it on every retry, including after a network failure where it never
  saw the response. Regenerating it can double-book.

The slot grid itself (`packages/engine/src/utils/grid`) is the other hard part: it handles DST
transitions and sessions that cross midnight (the venue opens 14:00 to 02:00).

## Commands

- `pnpm install`, then `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test`.
- `pnpm dev:web` (5173) / `pnpm dev:api` (3001).
- `pnpm --filter @playstop/api seed` seeds the venue, 15 stations, and demo bookings for the
  current week (taken cells, a maintenance window, a retired station, a booked-out station). The
  demo data is idempotent and re-anchors to the running week on each seed. `--no-demo-data` skips
  it. A weekly GitHub Actions cron (`.github/workflows/weekly-seed.yml`) reseeds prod every Monday
  so the live demo always shows the current week.

## Deploy

- Web on Cloudflare Pages (dashboard config). API on Render free (`render.yaml`).
- Pages talks to Render over HTTPS via `VITE_API_URL`. Render's `WEB_ORIGIN` is the Pages URL,
  used for CORS as an exact-match string.
- One Atlas cluster, two database names (`playstop_dev`, `playstop`), scoped user per database.
- Render free spins down after 15 minutes idle. A cron Cloudflare Worker pings `/health` every
  5 minutes to keep it warm, which also keeps Atlas from auto-pausing.

## Testing

Three layers. Engine tests are pure and run anywhere. The concurrency proof (a 50-way burst
against the unique index) runs in CI only, against real Mongo replica set and Redis service
containers, because Atlas M0 throttles at 100 ops/second and would produce failures
indistinguishable from real races. It is gated behind `TEST_PROFILE=ci`.

## Finding a booking

A confirmed booking is reachable two ways, with no accounts. `/bookings` is a device-local list
(localStorage, no backend). `/bookings/find` verifies the player's email or phone through the
existing OTP flow, then lists every booking for that contact via `POST /bookings/lookup`: the
contact is read from the verified OTP record, never client-supplied, so you cannot list someone
else's bookings by typing their number. Backed by the `idx_booking_contact` index; read-only.

## Out of scope on purpose

No auth, accounts, staff view, date picker, or TanStack Table (nothing here is tabular). No
Docker, no local database. OTP delivery is mocked (the code shows on screen). Wiring a real email
sender is not just the `apps/api/src/libs/notify` swap: every reputable provider requires a
verified sending domain (SPF/DKIM/DMARC), and the project owns none (it lives on `*.pages.dev` and
`*.onrender.com`), so real email needs buying a domain first. Kept mock on purpose; prod is a
recruiter demo. SMS has no free India path (DLT registration plus per-message cost).
