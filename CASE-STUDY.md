# PlayStop

A self-serve booking app for a physical gaming lounge. Players pick a PS5, PS3, PS2, or racing
sim, choose a time on a 30-minute grid, verify a one-time code, and get a confirmation. Live on
Cloudflare Pages and Render, backed by MongoDB Atlas and Upstash Redis.

## The problem worth solving

Most booking-form tutorials skip the part that actually matters: the resource is physical. There
are seven PS5s, not seven thousand. If two people book the same console for the same half hour,
two groups show up and one gets turned away. So the whole project is really about one question,
how do you make a double booking impossible when two requests race for the last free cell.

## How the concurrency holds

The answer is a single partial unique index in MongoDB on `(venueId, cellStart, stationId)`. That
index is the only thing standing between the app and a double booking, and every other decision
follows from admitting that up front.

A booking can span several 30-minute cells. The booking record and one claim row per cell are
written inside one Mongo transaction, so a booking that loses the race on any single cell leaves
nothing behind, not a partial reservation, not an orphaned row. The test that proves this
deliberately conflicts on the *middle* cell of a range, because a naive first-cell check would
pass even with no transaction at all.

Redis sits in front as a soft hold with a short TTL. It makes the normal path pleasant (you see a
cell go unavailable while someone else is mid-checkout), but it is explicitly not treated as
proof. If Redis goes down, availability degrades to optimistic (held cells show as free) and the
app still books, taking the occasional conflict at confirm time rather than turning a cache
outage into a booking outage. The unique index catches whatever slips through.

I verified this with a concurrency suite that fires a 50-way simultaneous burst at the same range
and asserts exactly one winner. It runs in CI against a real Mongo replica set and a real Redis,
not mocks, because the free Atlas tier throttles at 100 ops a second and would manufacture false
races of its own.

## Constraints that shaped the build

I wanted a live `onrender.com` URL because that is what a recruiter can click. Getting there on
free infrastructure took real research: a homelab path was ruled out (Render cannot reach an
unexposed network without a paid tier), and several hosts that look free on paper are not. The
result is one Atlas cluster split into dev and prod databases by name with a scoped user each, one
pair of Upstash databases, and a small cron Worker that pings the health check every five minutes
so the free Render instance never cold-starts and Atlas never auto-pauses.

## Shape of the code

A pnpm monorepo with a deliberate split. A zero-dependency `types` package holds the domain
vocabulary and the on-disk document shapes. An `engine` package holds every Zod contract that
crosses the network plus the pure logic: the slot grid, availability, and pricing. The grid is the
other genuinely hard piece, it has to handle daylight-saving transitions and sessions that cross
midnight, since the venue opens 14:00 to 02:00. Because every wire shape is one Zod schema
imported by both the API and the web client, the two halves cannot drift apart.

The frontend is React 19 on Tailwind v4 and shadcn/ui, driven off the URL rather than component
state so the back button, a reload, and a shared link all work. The client half of the
idempotency design lives in one small module: it mints an idempotency key once per attempt and
resends a frozen request body verbatim on every retry, which is the only thing that keeps a
confirm whose response never arrived from turning into a second booking.

## What I would do next

OTP delivery is mocked today (the code shows on screen), which is the right call for a portfolio
demo and a one-file swap away from a real SMS or email provider. Beyond that, a staff view and
accounts are the obvious next milestone, both left out on purpose to keep the current scope
honest.

## Stack

TypeScript (strict), React 19, Vite, Tailwind v4, shadcn/ui, TanStack Router and Query, Express 5,
Zod, MongoDB (native driver), Redis (ioredis), pnpm workspaces. Deployed on Cloudflare Pages,
Render, MongoDB Atlas, and Upstash Redis, with CI on GitHub Actions.
