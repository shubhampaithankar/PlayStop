# Milestone 3 specification: the player-facing booking flow (`apps/web`)

Companion to `docs/milestone-2-spec.md` (the API, built and tested) and `DESIGN.md` (the binding
design contract). This file says how to build the client. It does not restate the API and it does
not redesign the UI. Where it deviates from `DESIGN.md`, section 15 says so and says why.

Scope: four screens, one venue, no auth, no accounts, no staff view.

```
/                     venue landing, pick a date
/book                 availability grid across stations
/book/:stationId      hold panel: countdown, player form, confirm
/booking/:id          confirmation and cancel
```

---

## 0. Prerequisites outside `apps/web`

Two one-line changes elsewhere in the repo. Both are verifiable and neither touches API behaviour.

1. `packages/engine/package.json`: add `"sideEffects": false`. `apps/web` imports `priceBooking`
   for the running total (section 3 of the milestone 2 spec says the formula lives in the engine so
   the client does not duplicate it). Without this flag, Rollup's tree shaking of `grid.ts` and its
   `luxon` dependency is a judgement call rather than a guarantee, and `luxon` is roughly 70 KB
   gzipped that this client has no use for. Step 1 of the build order verifies `luxon` is absent
   from the production bundle.

2. `apps/api/src/app.ts`: `cors({ origin: env.WEB_ORIGIN, exposedHeaders: ["X-Request-Id", "Retry-After", "Idempotent-Replay"] })`.
   In production the client is on Cloudflare Pages and the API is on Render, so every request is
   cross-origin, and by default browser JavaScript can read only the CORS-safelisted response
   headers. Without this, `X-Request-Id` and `Retry-After` are invisible to the client.

Change 2 is a convenience, not a dependency. The spec below works without it: the error envelope
already carries `requestId` in the body, and every `Retry-After` value the API sends is a constant
this document hardcodes. Build the client so it prefers the header and falls back to the constant,
and it is correct either way.

**Related fact, do not get this wrong:** `apps/api/src/middleware/request-id.ts` always generates
its own id and ignores any incoming `X-Request-Id`. The client therefore **reads** that header (and
`error.requestId` from the body) and **never sends** one. Sending a request id the server discards
would produce a correlation id that correlates nothing.

---

## 1. Dependencies, and what is deliberately absent

Add to `apps/web/package.json`:

```
dependencies:
  @playstop/engine        workspace:*     schemas (apiErrorSchema, createBookingRequestSchema, etc.) and priceBooking
  @tanstack/react-router   ^1
  @tanstack/react-query    ^5
  @sentry/react            ^10
  zod                      ^3             same major as packages/engine
  clsx, tailwind-merge                    pulled in by shadcn's lib/utils
  class-variance-authority                pulled in by shadcn button/badge/alert
  lucide-react                            icons, tree shaken
  sonner, vaul, react-day-picker, @radix-ui/*   pulled in by the shadcn components added in step 2
  @fontsource/saira-semi-condensed, @fontsource/ibm-plex-sans, @fontsource/ibm-plex-mono

devDependencies:
  @tanstack/react-query-devtools, @tanstack/react-router-devtools   dev-only imports
```

**No TanStack Table.** The constraint list mandates it and this milestone does not use it, stated
plainly rather than smuggled past. None of the four screens contains a data table: there is no
sorting, no filtering, no pagination, no column model, and no row model. The availability grid is a
fixed two-dimensional projection of one array whose axes swap at a breakpoint, which is a CSS grid
problem, not a table-state problem. Adding a table library to it would mean fighting a column model
that transposes. TanStack Table earns its place the moment the staff "today's schedule" view from
milestone 2's open questions gets built, which is a genuine sortable, filterable table. Use it there.

**No `react-hook-form`.** The player form has three fields and one submit. React 19's
`useActionState` plus the `Form`/`Input`/`Label` primitives from shadcn cover it. Field errors come
from two places, both already typed: a local Zod parse against the shared
`createBookingRequestSchema`, and `details` on a `VALIDATION_FAILED` response.

**No date library.** `Intl.DateTimeFormat` with `timeZone: venue.timezone` produces every string
this client needs. `luxon` exists in the engine for grid generation, which the client never does.

**No state manager.** Server state is TanStack Query. The only client state that outlives a
component is the booking attempt record (section 5), which lives in `sessionStorage` because it must
survive a reload, and a store cannot do that.

---

## 2. File layout, and the route tree

Exactly the agreed structure. A folder holding one file is a defect.

```
apps/web/src/
  main.tsx              mount, StrictMode, QueryClientProvider, RouterProvider. Nothing else.
  router.tsx            Sentry.init (needs the router instance), createRouter, the Register decl.
  index.css             @import "tailwindcss", @theme tokens, shadcn variable mapping, fonts.
  routes/
    root.tsx            createRootRoute: header/wordmark, <Outlet/>, <Toaster/>, error + notFound.
    index.tsx           /
    book.tsx            /book        renders the grid AND <Outlet/> for the hold panel
    book.station.tsx    /book/$stationId   child of book.tsx, renders Drawer or Dialog
    booking.tsx         /booking/$bookingId
  components/ui/        shadcn generated. Never hand edited.
  lib/
    api.ts              the single network choke point, the error types, the error presentation map
    query-client.ts     QueryClient config, query key factory, queryOptions builders
    grid.ts             pure functions: layout projection, range selection, time math, attempt record
```

`lib/grid.ts` is the third file in `lib/`, which is why it is a file and not a folder. It holds
every pure function in the app, which is also every function worth an automated test (section 13).
It imports only relative paths and `@playstop/types` so `node --test` can run it without a bundler
resolving `@/`.

### Routing is code based, not file based

`createRootRoute` and `createRoute` from `@tanstack/react-router`, assembled in `router.tsx`. No
`@tanstack/router-plugin`, no `routeTree.gen.ts`. Four routes do not justify a codegen step, a
generated file in version control, and a build plugin, and the agreed layout has no place to put the
generated file. Each `routes/*.tsx` exports its route object plus its component; `router.tsx`
imports them and calls `addChildren` in object form.

`router.tsx` must include the type registration, which is not optional:

```ts
declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
```

Without it, `Link`, `useNavigate`, `useSearch`, and `useParams` have no type safety at all, which
removes the main reason to use this router.

### Search parameters are the flow's memory

Every piece of state that must survive a reload, a back button, or a pasted link is a search param,
validated with the shared schemas. Nothing about a booking in progress lives only in React state.

| Route | Path params | Search params | Validation |
|---|---|---|---|
| `/` | | none | |
| `/book` | | `date` (required), `kind` (optional) | `localDateSchema`, `stationKindSchema` |
| `/book/$stationId` | `stationId` | `date`, `start` (ISO instant), `slots` (int) | `objectIdSchema`, `isoInstantSchema` |
| `/booking/$bookingId` | `bookingId` | `code` (required) | the confirmation code shape |

`validateSearch` uses a Zod object built from `@playstop/engine` primitives and a `.catch()` per
field, so a hand-mangled URL redirects to a sane default instead of throwing. `/book` with a missing
or unparseable `date` gets `defaultBusinessDate(venue, now)` (section 7). `/book/$stationId` with a
missing `start` or `slots` navigates back to `/book`, because there is no range to hold.

`/book/$stationId` is a **child** of `/book`. The grid stays mounted underneath the hold panel, its
query stays warm, the browser back button closes the panel, and the URL is shareable. The panel
itself is a shadcn `Drawer` below `md` and a `Dialog` at `md` and above, per `DESIGN.md`, both with
`onOpenChange` wired to `navigate({ to: "/book", search })`.

### Sentry

`router.tsx`, above `createRouter`, because `tanstackRouterBrowserTracingIntegration(router)` takes
the router instance:

```ts
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,   // undefined disables the SDK, same as the API
  integrations: [tanstackRouterBrowserTracingIntegration(router)],
  tracesSampleRate: 0.1,
  beforeSend: (event) => (import.meta.env.DEV ? null : event),
});
```

Mirror the API's filtering rule: an `ApiRequestError` whose status is 404, 409, 410, 422, or 429 is
expected traffic, not a bug. Drop those in `beforeSend`. Report `NetworkError`, 5xx, and anything
that reaches the root `errorComponent`. Tag every event with the `requestId` from the error body so
a client event joins a server log line.

New env vars, added to `.env.example` and the Cloudflare Pages dashboard:

| Var | Required | Notes |
|---|---|---|
| `VITE_API_URL` | yes | already exists |
| `VITE_VENUE_SLUG` | yes | `playstop-indiranagar` in dev, matching `apps/api/src/seed.ts` |
| `VITE_SENTRY_DSN` | no | absent disables Sentry entirely, as in the API |

Read all three once at module scope in `lib/api.ts` and `router.tsx`. Do not scatter
`import.meta.env` reads through components.

---

## 3. `lib/api.ts`, the single choke point

Every network call in the app goes through one function. No component calls `fetch`. No query
function calls `fetch`. This is the only place that knows the base URL, the venue slug, the header
set, and how a non-2xx body becomes a typed error.

### The two error types

```ts
import { apiErrorSchema, type ErrorCode } from "@playstop/engine";

/** The server answered with a structured error. `code` is the closed union from packages/engine. */
export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly requestId: string,
    readonly details: unknown,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super(message);
  }
}

/** The request never produced a server answer. `outcomeUnknown` drives the retry rules. */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
  constructor(
    message: string,
    /** True when the request may have reached the server and been processed. */
    readonly outcomeUnknown: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}
```

Those are the only two error types the rest of the app catches. A component or mutation handler
discriminates like this, and nothing else:

```ts
if (error instanceof ApiRequestError) {
  switch (error.code) {
    case "HOLD_EXPIRED": ...
    case "SLOT_TAKEN": ...
    ...
  }
}
```

`outcomeUnknown` is `true` for a fetch rejection on a **non-idempotent** call (a POST that may have
been received), and `false` for a GET or for an `AbortError` the client itself triggered. It is the
flag that decides whether a retry may reuse the idempotency key or must warn the user first
(section 5).

### The request function

```ts
type Method = "GET" | "POST";

async function request<T>(opts: {
  method: Method;
  path: string;                       // relative to /v1/venues/{slug}, e.g. "/availability"
  query?: Record<string, string>;
  body?: unknown;
  idempotencyKey?: string;
  schema: z.ZodType<T>;               // the response schema from @playstop/engine
  signal?: AbortSignal;
  timeoutMs?: number;                 // default 90_000, see section 8
}): Promise<T>
```

Behaviour, in order:

1. URL is `${VITE_API_URL}/v1/venues/${VITE_VENUE_SLUG}${path}` plus the query string. The venue
   slug is applied here and nowhere else, so no caller can forget it or spell it differently.
2. Headers: `Accept: application/json` always; `Content-Type: application/json` when there is a
   body; `Idempotency-Key` when supplied. Never `X-Request-Id` (see section 0).
3. `signal`: `AbortSignal.any([caller signal, AbortSignal.timeout(timeoutMs)])`. The long default
   exists for cold start; section 8.
4. `fetch` rejection: throw `NetworkError`, with `outcomeUnknown = method === "POST" && the abort
   was not caller-initiated`.
5. `res.status === 204`: return `undefined as T`. Only `POST /holds/release` uses it, and its
   `schema` is `z.undefined()`.
6. `res.ok`: `await res.json()`, then `schema.parse(...)`. A parse failure is a genuine contract
   break between the client and a deployed API, so it throws (a Zod error, which the root error
   boundary reports to Sentry). Do not `safeParse` and shrug: a silently mis-shaped booking response
   is worse than a visible crash.
7. Non-2xx: read `Retry-After` (a number of seconds, `undefined` when unreadable), then
   `await res.json().catch(() => null)` and `apiErrorSchema.safeParse` it.
   - Parsed: throw `ApiRequestError` from `body.error.code`, `body.error.message`,
     `body.error.requestId`, `body.error.details`, plus the status and retry hint.
   - Not parsed: throw `ApiRequestError("INTERNAL", res.status, "Something went wrong on our side.",
     res.headers.get("X-Request-Id") ?? "unknown", undefined, retryAfter)`.

Step 7's fallback is load bearing, not defensive padding. During a Render cold start the client can
receive a 502 with an HTML body from the platform, not from Express, and the entire error path must
survive that without throwing a `SyntaxError` inside the error handler.

### The seven exported callers

One thin function per endpoint. Each names its response schema. Nothing else in the app constructs
a path.

```ts
export const getVenue        = ()                          => request({ method:"GET",  path:"",                              schema: venueResponseSchema });
export const getAvailability = (q: AvailabilityQuery)      => request({ method:"GET",  path:"/availability", query: ...,     schema: availabilityResponseSchema });
export const createHold      = (b: CreateHoldRequest)      => request({ method:"POST", path:"/holds",        body: b,        schema: createHoldResponseSchema });
export const releaseHold     = (b: ReleaseHoldRequest)     => request({ method:"POST", path:"/holds/release",body: b,        schema: z.undefined() });
export const createBooking   = (b: CreateBookingRequest, idempotencyKey: string)
                                                            => request({ method:"POST", path:"/bookings",     body: b, idempotencyKey, schema: bookingResponseSchema });
export const getBooking      = (id: string, code: string)  => request({ method:"GET",  path:`/bookings/${id}`, query:{code}, schema: bookingResponseSchema });
export const cancelBooking   = (id: string, code: string)  => request({ method:"POST", path:`/bookings/${id}/cancel`, body:{confirmationCode:code}, schema: bookingResponseSchema });
```

**`exactOptionalPropertyTypes: true` is on in `tsconfig.base.json`.** Building a
`CreateBookingRequest` by spreading `{ email: form.email || undefined }` will not typecheck and,
worse, `JSON.stringify` drops the key anyway so the two are not equivalent in the mind of whoever
reads it later. Build the body by conditional spread:

```ts
player: { name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) }
```

The same rule applies to the optional `holdId`: omit the key, never send `undefined`.

---

## 4. Query keys, invalidation, and polling

`lib/query-client.ts` exports the key factory, the `queryOptions` builders, and the configured
`QueryClient`. Keys are built by the factory and never by hand at a call site.

```ts
export const keys = {
  venue:        ()                                  => ["venue"] as const,
  availability: (date: string, kind?: StationKind)  => ["availability", date, kind ?? "all"] as const,
  booking:      (id: string)                        => ["booking", id] as const,
} as const;
```

The venue slug is not in the key because there is one venue per deployment and it comes from an env
var, not from state. If a venue switcher ever exists, the slug becomes the second element of every
key and this factory is the only file that changes.

The confirmation code is **not** in the booking key, even though the read requires it. A key is a
cache address; putting a credential in it means the credential appears in the devtools, in any cache
dump, and in every log line that prints a key. The code is passed to the query function as a closure
argument instead.

### Defaults

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) =>
        error instanceof ApiRequestError && error.status < 500 ? false : failureCount < 3,
      retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
})
```

Two rules in there matter. A 4xx is a decision, so retrying it wastes a request and delays the error
UI; a 5xx or a `NetworkError` is worth three tries because a cold-starting Render instance answers
502 before it answers 200. **Mutations never retry automatically.** Every mutation in this app is a
hold, a confirm, or a cancel, and an automatic retry of a confirm is precisely the thing the
idempotency key exists to make safe and the thing a human must nonetheless choose to do.

### Per-query configuration

| Query | staleTime | Polling | Notes |
|---|---|---|---|
| `keys.venue()` | `Infinity` | never | Opening hours and station list do not change during a session. Fetched once in the root route loader so every screen can assume it. |
| `keys.availability(date, kind)` | `10_000` | see below | |
| `keys.booking(id)` | `30_000` | never | Seeded by `setQueryData` from the confirm response, so `/booking/:id` renders without a network round trip. |

### Availability polling

The backend has no push channel and a cell can be taken by another player at any moment, so the grid
must poll. It also must not poll pointlessly.

```ts
refetchInterval: (query) => {
  if (holdPanelOpen) return false;                 // passed in from the /book component
  if (query.state.data?.closed) return false;      // nothing on this date can change
  if (query.state.status === "error") return 60_000;  // backoff
  return 20_000;
},
refetchIntervalInBackground: false,   // the default; stated because it is load bearing
```

Twenty seconds. The reasoning, not a guess: the API's rate limit is 30 requests per minute per
`venueId:ip` and it applies to POSTs only, so GET polling has no server-side ceiling; the real cost
is Atlas M0's 100 operations per second shared with every confirm, and an availability read is a few
operations. Three requests per minute per open tab is invisible against that. Below roughly ten
seconds the user perceives no improvement, because the window between a rival's confirm and this
grid updating is dominated by the rival's own typing time, not by the poll interval.

`refetchIntervalInBackground: false` means a backgrounded tab stops polling entirely, and
`refetchOnWindowFocus: true` means it refetches the instant the user comes back. That pairing is the
whole backoff story for the common case: an abandoned tab costs nothing and is never stale when it
matters.

Error backoff is 60 seconds rather than an exponential ramp because the failure this protects
against is a sleeping API, and a sleeping API wakes on the next request regardless of how patiently
the client waited. A ramp would just make the recovery slower to notice.

Polling pauses while the hold panel is open. The user has a hold, the grid is behind a modal, and a
refetch would repaint 360 cells nobody is looking at. It resumes on close, and the close path
invalidates anyway.

### Invalidation, exactly

Availability must be correct after every write. Every mutation's `onSettled` (not `onSuccess`,
because a 409 changes the world too and is exactly when the user most needs fresh cells) does:

```ts
queryClient.invalidateQueries({ queryKey: ["availability"] })
```

The prefix form, deliberately: a hold or a booking that crosses midnight affects two business dates,
and a `kind` filter means the same night is cached under several keys. Invalidating the prefix
refetches every availability query currently mounted (which is at most one) and marks the rest
stale, which costs nothing.

| Event | Invalidate | Also |
|---|---|---|
| Hold created (201) | `["availability"]` | write the attempt record, navigate to the panel |
| Hold released (204) | `["availability"]` | clear the attempt record |
| Hold failed (409, 422, 503) | `["availability"]` | see section 6 |
| Booking confirmed (201) | `["availability"]` | `setQueryData(keys.booking(id), booking)`, clear the attempt record, navigate |
| Confirm failed (409, 410) | `["availability"]` | see section 6 |
| Cancel succeeded (200) | `["availability"]` | `setQueryData(keys.booking(id), cancelled)` |

Nothing invalidates the venue query. Nothing invalidates a booking query except its own cancel,
which sets the data directly rather than refetching it.

---

## 5. The hold lifecycle and the idempotency key

This is the part with the sharp edges. Read it before writing any of it.

### The booking attempt record

One object, in `sessionStorage`, under the key `playstop.attempt`. It is the client's entire memory
of a booking in progress and it is created and destroyed at exactly the points listed below.

```ts
export interface BookingAttempt {
  readonly idempotencyKey: string;   // crypto.randomUUID(), created ONCE, see below
  readonly stationId: string;
  readonly startsAt: string;         // ISO instant, verbatim from the cell
  readonly slotCount: number;
  readonly hold: null | {            // null when the hold could not be acquired (degraded mode)
    readonly holdId: string;
    readonly expiresAt: string;      // ISO instant from the server
    readonly ttlSeconds: number;
    readonly quoteMinor: number;
    readonly currency: string;
  };
  /** Set on the first confirm submit and never mutated. Retries resend exactly this. */
  readonly submitted: null | CreateBookingRequest;
  /** Set when a confirm POST failed without a server answer. Locks the form. */
  readonly outcomeUnknown: boolean;
}
```

`sessionStorage`, not `localStorage`: the record is per tab and dies with the tab, which is the
correct lifetime for a five-minute hold. `localStorage` would resurrect a long-dead hold in a new
window a day later and confuse the reload path below.

Read, write, and clear it through three functions in `lib/grid.ts` (`readAttempt`, `writeAttempt`,
`clearAttempt`), each of which tolerates a corrupt or absent value by returning `null` and deleting
the key. Nothing else touches `sessionStorage`.

### The idempotency key: created once, per attempt, reused on every retry

**Where it is created:** in the `createHold` mutation's handler on `/book`, in the same statement
that writes the attempt record, before the hold request is sent. One `crypto.randomUUID()` call.

**Where it is stored:** in the attempt record, so it survives a reload of the hold panel.

**Its lifetime:** from the moment the user commits to a range until one of exactly four events:

1. A 201 from `POST /bookings`. The attempt is finished; clear the record.
2. The user deliberately changes the request (a different station, a different start, a different
   duration, or "start over" after a locked form). That is a different booking, so it gets a
   different key and a different hold.
3. `IDEMPOTENCY_KEY_REUSED` (422). That response means the key is already bound to a different body,
   which can only happen if this client has a bug. Generate a fresh key, do not retry the old one.
4. The tab closes.

**It is never regenerated on a retry.** Not after a 5xx, not after a timeout, and above all not
after a network failure where the client saw no response. Regenerating it there is the double-booking
bug this entire mechanism exists to prevent: the first POST may have committed a booking, and a
second POST with a fresh key is a brand new request that will happily commit a second one.

**The body is frozen with the key.** On the first confirm submit, write `submitted` into the record
and send that object. Every retry sends `attempt.submitted` verbatim, not a re-read of the form.
This is required, not tidiness: the server hashes the canonicalised body and compares it to the
hash stored against the key, so a retry that differs by one character of a name gets a 422
`IDEMPOTENCY_KEY_REUSED` instead of the replay it wanted.

Consequence, and it must be built: **once a confirm has been submitted, the form is read only.** The
name, email, phone, and party size inputs get `disabled` while a confirm is in flight and stay
disabled after a failure that left the outcome unknown. The available actions are "Try again" (same
key, same body) and "Start over" (section 6's terminal path), which is a deliberate act with a
warning attached.

### The countdown

Derived from `expiresAt`, never from a client-side counter. Per `DESIGN.md`:

```ts
const [nowMs, setNowMs] = useState(() => Date.now());
useEffect(() => {
  const id = setInterval(() => setNowMs(Date.now()), 1000);
  const onVisible = () => setNowMs(Date.now());
  document.addEventListener("visibilitychange", onVisible);
  return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
}, []);
const remainingMs = Math.max(0, Date.parse(attempt.hold.expiresAt) - nowMs);
```

The interval is a **tick source**, not a counter. It never decrements anything. If the tab sleeps
for four minutes and fires once on wake, `remainingMs` is correct on that single tick, and the
`visibilitychange` listener makes the correction immediate rather than up to a second late. This is
the difference `DESIGN.md` is asking for and it is why `setInterval` appearing in the code is not a
violation of "do not run the countdown off `setInterval` drift".

`remainingMs` derives everything: the `Progress` value (`remainingMs / (ttlSeconds * 1000)`), the
`m:ss` digits, the colour band (green above 60s, amber 60 down to 21s, red at 20 and below), and
`expired = remainingMs === 0`. There is no `isExpired` state variable to get out of sync.

Announcements at 60s, 20s, and 0 go into a `aria-live="polite"` region, each guarded by a `useRef`
boolean so a resumed tab that jumps from 180s to 0s announces once, not three times.

A clock-skew note, because this is a real client: `expiresAt` is the server's clock and `Date.now()`
is the user's. A user whose clock is two minutes fast sees an expiry two minutes early. That is
acceptable (it fails safe, in the direction of confirming sooner) and it is not worth correcting with
a `Date` header offset for a five-minute TTL.

### Expiry while the user is typing

`expired` is derived, so the transition needs no event. At `remainingMs === 0` the panel renders the
expired state from `DESIGN.md`: bar empty, panel border red, form inputs disabled, copy swapped to
"Hold expired, the slot may have been taken", two actions.

- **"Try to hold again"** re-POSTs `/holds` with the same `stationId`, `startsAt`, and `slotCount`.
  On 201 it writes a new `hold` block into the **existing** attempt record and keeps the existing
  idempotency key, because the request body has not changed. On 409 it is gone; see section 6.
- **"Back to grid"** clears the record and navigates to `/book`.

**Typed values are kept.** The name, email, phone, and party size stay in React state across the
expiry and are restored into the form when a re-hold succeeds. Making a user retype their name
because a timer ran out is a UI that punishes the user for its own countdown.

A 410 `HOLD_EXPIRED` on confirm lands on this same state via the same code path. It is one rendered
state with two entrances, not two states.

### Releasing the hold: what is achievable, honestly

Three exit routes, three different levels of reliability. Stating them accurately matters more than
pretending all three work.

1. **In-app navigation and the back button: reliable.** The hold panel component's unmount effect
   fires `releaseHold`, fire and forget, when the attempt still has a live hold and no booking was
   confirmed. TanStack Router unmounts the child route on navigation, so back, "Back to grid", and a
   `Link` elsewhere all land here. A failure is ignored: the user has already left and there is
   nothing to tell them.

2. **Tab close and reload: best effort, and it will sometimes not fire.** A `pagehide` listener
   issues `fetch(url, { method: "POST", body, headers, keepalive: true })`. Use `pagehide`, not
   `beforeunload`: `beforeunload` is unreliable on mobile Safari and Chrome for Android, which is
   most of this audience, and `pagehide` fires on the bfcache path too. `navigator.sendBeacon` is
   **not** usable here: the endpoint needs `Content-Type: application/json`, which makes the request
   non-simple, which makes it preflighted, and `sendBeacon` cannot preflight. Do not add a
   `beforeunload` confirmation dialog. It is user hostile, browsers increasingly ignore it, and it
   buys nothing a five-minute TTL does not already cover.

3. **The TTL is the real backstop, and that is fine.** `HOLD_TTL_SECONDS` defaults to 300. The worst
   case of every release failing is that a station shows as held for up to five minutes after
   someone walked away. The API was designed with exactly this in mind: `PX` on every key, no
   sweeper, no cleanup job, and `holdRelease` is a compare-and-delete precisely because a late
   release must not steal someone else's hold. Do not build a heartbeat, a hold-extension endpoint,
   or a service worker to improve on this.

### Reload mid-flow, when the hold is live but `holdId` is gone

This is why the attempt record exists and why it is in `sessionStorage`.

On mount, `/book/$stationId` reads the record and compares it against the route's `stationId`,
`start`, and `slots`. Four cases, no others:

| Record | Rendered state |
|---|---|
| Matches the route, `hold` present, `expiresAt` in the future | **Resume.** Countdown continues from `expiresAt`, form restored empty, the same idempotency key is still in play. The user cannot tell a reload happened. |
| Matches the route, `hold` present, `expiresAt` in the past | The expired state above. The hold is already gone server side; nothing to release. |
| Matches the route, `hold` is `null` | The degraded path (section 9): no countdown, confirm proceeds without a `holdId`. |
| Absent, or does not match the route | **Resume prompt.** No countdown, no form. One button: "Hold PS5-2, 19:30 to 21:00". Pressing it creates a fresh attempt record (new key) and POSTs the hold. |

That last row is also the deep-link case (someone pastes the URL) and the
cleared-storage case, and it is the reason the hold is **never** created in an effect on mount. A
POST that fires because a component rendered is a request the user did not ask for, it double-fires
under StrictMode in development, and it makes a shared link create holds. Every hold in this app
originates in a click: the "Hold this slot" button on `/book`, the "Try to hold again" button in the
expired panel, or the resume button above.

If a mismatched record exists (the user was mid-flow on a different range and navigated here), fire
a release for the **old** range before overwriting the record. That is the one place a release fires
for something other than the current route.

---

## 6. Error handling, code by code

`lib/api.ts` exports one exhaustive map. Because `ErrorCode` is a closed Zod enum shared from
`packages/types`, typing it as `Record<ErrorCode, ErrorPresentation>` makes the compiler fail the
build the day someone adds a code to the API. That is the payoff milestone 2 promised when it made
the enum shared, so collect it:

```ts
type Recovery =
  | "retry-same"       // same request, same idempotency key, a button the user presses
  | "rehold"           // the range may still be free: re-acquire a hold, then confirm
  | "refetch-and-pick" // the range is gone: refresh the grid, choose again
  | "fix-input"        // the user must change a field
  | "terminal";        // nothing the user can do here

interface ErrorPresentation {
  readonly title: string;
  readonly detail: string;       // may be replaced by the server's message where it is better
  readonly recovery: Recovery;
  readonly surface: "toast" | "panel" | "field" | "page";
  readonly reportToSentry: boolean;
}

export const errorPresentation: Record<ErrorCode, ErrorPresentation> = { ... };
```

Where the server's `message` names the specific time range (it does for the conflict codes), prefer
it over the static `detail`. The API's voice already matches `DESIGN.md`, and a message that says
"Someone else holds 19:30 to 20:30" beats a generic one.

### The distinction that matters most

**`HOLD_EXPIRED` (410) means try again. `SLOT_TAKEN` (409) means it is gone.** Collapsing them into
one "something went wrong" toast is the single worst thing this client could do, because the two
demand opposite actions from the user. The API separated them deliberately; the UI must keep them
separated all the way to the pixel.

- `HOLD_EXPIRED`: the countdown ran out and the cells **may still be free**. The panel stays open on
  the same range, shows the expired state, and offers "Try to hold again" as the primary action.
  The user's typed details survive.
- `SLOT_TAKEN`: another booking is committed on at least one cell. The range is unrecoverable. Close
  the panel, refetch availability so the grid shows the truth, clear the attempt record, and toast
  the server's message naming the range. Do not offer a retry, because there is nothing to retry.

### The table

| Code | HTTP | Where it appears | What the user sees | What the app does | Class |
|---|---|---|---|---|---|
| `SLOT_TAKEN` | 409 | hold, confirm | Toast, server message naming the range: "Part of 19:30 to 21:00 was just booked." | Clear the attempt, invalidate availability, navigate to `/book`. If `details.conflictingCellStart` is present, flash that cell's outline for 2s (respecting `prefers-reduced-motion` by skipping the flash). | terminal for this range |
| `SLOT_HELD` | 409 | hold, confirm | Toast: "Someone else holds part of 19:30 to 21:00. Pick another start." | Same as `SLOT_TAKEN`, minus the cell flash. The cells will show as `held` after the refetch, which explains it visually. | terminal for this range |
| `HOLD_EXPIRED` | 410 | confirm | The expired panel state from `DESIGN.md`, in place, not a toast. | Keep the panel, keep the typed form values, keep the attempt record and its key, offer "Try to hold again" and "Back to grid". | rehold |
| `SLOT_UNAVAILABLE` | 409 | hold, confirm | Toast: "That time is blocked for maintenance." | Same as `SLOT_TAKEN`. The refetched grid shows the crosshatch, which is the real explanation. | terminal |
| `SLOT_NOT_ON_GRID` | 422 | hold, confirm | Toast: "That time is no longer bookable. The schedule was refreshed." | This is a client bug or a stale grid across a venue config change. Clear the attempt, invalidate availability **and** the venue query, return to `/book`. Report to Sentry: the client should never construct a start instant, only echo one from a cell. | terminal, reported |
| `SLOT_OUT_OF_WINDOW` | 422 | hold, confirm | Toast: "That slot has passed, or runs past closing. Pick another." | Clear the attempt, invalidate availability, return to `/book`. Common and benign: the user sat on the grid past the lead time. Not reported. | terminal |
| `SLOT_COUNT_OUT_OF_RANGE` | 422 | hold, confirm | Inline in the selection bar: "This station takes 1 to 4 hours." | Clamp the stepper to the station's `minSlots` and `maxSlots` from the venue query and re-render. Reaching this means the client's clamp is wrong, so report it. | fix-input, reported |
| `PARTY_SIZE_EXCEEDS_CAPACITY` | 422 | confirm | Field error under the party size control: "This station seats N." | Enable the form (this one is safe to unlock, the outcome is known), focus the field. | fix-input |
| `VALIDATION_FAILED` | 400 | any | Field errors from `details`, which is `zodError.flatten()`. Map `fieldErrors.player.name` and friends onto the matching inputs; anything in `formErrors` becomes a panel-level message. | Enable the form, focus the first field with an error. Report to Sentry, because the client parses the same schema before sending and should never hit this. | fix-input, reported |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | confirm | Generic panel error: "Something went wrong on our side." | Pure client bug. Report. `lib/api.ts` sends the header on the booking call and there is only one call site. | terminal, reported |
| `IDEMPOTENCY_KEY_REUSED` | 422 | confirm | Generic panel error, same copy as above. | Client bug: the frozen-body rule was violated somewhere. Generate a fresh idempotency key into the attempt record, clear `submitted`, unlock the form, and let the user submit again. Report. | retry, reported |
| `REQUEST_IN_FLIGHT` | 409 | confirm | The confirm button stays in its loading state with "Still working..." under it. | The user double-submitted, or a previous attempt is still running. Auto-retry the identical request once after `Retry-After` seconds (fallback 1s), then, if it happens again, stop and show "Try again". This is the one automatic retry in the app, and it is safe because the key and body are unchanged. | retry-same |
| `RATE_LIMITED` | 429 | hold, confirm, cancel | Toast: "Too many requests. Try again in N seconds." | Disable the triggering button for `Retry-After` seconds (fallback 30) with a live count on the label. Do not auto-retry. | retry-same |
| `HOLD_UNAVAILABLE` | 503 | hold, release | No error UI on release (silent, the TTL handles it). On hold: skip the countdown and go straight to the form with a persistent amber `Alert`. | Section 9. Write the attempt record with `hold: null` and navigate to the panel anyway. **This is not a failure to book.** | continue degraded |
| `BOOKING_TIMEOUT` | 503 | confirm, cancel | Panel: "We could not confirm in time. Your booking may or may not have gone through." Primary action "Try again", which is safe and correct. | The API deleted the idempotency record, so retrying the same key is permitted and is the right move. Retry after `Retry-After` seconds (fallback 2). Do **not** call this a conflict; the user does not know who won and neither do we. | retry-same |
| `BOOKING_NOT_FOUND` | 404 | booking read, cancel | Full-page state on `/booking/:id`: "We could not find that booking. Check the link, including the code at the end." | No retry. Do not disclose whether the id exists, matching the API's deliberate ambiguity. Offer a link back to `/`. | terminal |
| `BOOKING_NOT_CANCELLABLE` | 422 | cancel | Dialog message: "This session has already started. Call the venue." | Close the confirm dialog, refetch the booking. | terminal |
| `STATION_NOT_FOUND` | 404 | hold, confirm | Toast: "That station is no longer available." | Invalidate the venue query and return to `/book`. Happens when a station is retired mid-session. | terminal |
| `VENUE_NOT_FOUND` | 404 | any | Full-page state: misconfiguration, not a user error. | `VITE_VENUE_SLUG` is wrong for this deployment. Report to Sentry and show a plain "This venue is not available" page. | terminal, reported |
| `DATE_OUT_OF_RANGE` | 422 | availability | Full-grid empty state: "That date is not bookable." with a link to today. | Do not retry. The date picker should already prevent it via `maxAdvanceDays`. Report, because it means the picker's bounds are wrong. | terminal, reported |
| `NOT_FOUND` | 404 | any | Generic page error. | Client bug: a path was built wrong. Report. | terminal, reported |
| `INTERNAL` | 500 | any | "Something went wrong on our side." plus the request id in small mono text, so a user can quote it. | Query retries handle transient cases automatically. A mutation shows "Try again", which reuses the key. Report. | retry-same, reported |

`NetworkError` is not in the table because it is not an `ErrorCode`. Its handling:

- On a query: TanStack Query's retry policy covers it; after three failures show the offline state
  from section 8.
- On a hold or cancel mutation: toast "Could not reach the server. Check your connection." and a
  "Try again" button. Both are safe to repeat.
- **On a confirm mutation with `outcomeUnknown === true`: set `attempt.outcomeUnknown = true`, lock
  the form, and show two actions.** "Try again" resends the frozen body with the same key, and the
  server either replays the 201 it already produced or executes for the first time. Either outcome
  is correct and neither can double book. "Start over" carries the warning: "Your earlier attempt
  may have gone through. If you get a second confirmation, cancel one." That sentence is not
  pleasant and it is the truth; a client that cannot see the response genuinely cannot know.

---

## 7. The availability grid

The hardest screen, and the one everything else inherits from.

### One component tree, two orientations

There is exactly one grid component. The transposition is a projection of one array, not a second
tree.

The API returns a flat `cells` array. Build, once per response, in `lib/grid.ts`:

```ts
export interface GridModel {
  readonly stations: readonly StationSummary[];   // filtered by `kind`, order from the venue
  readonly times: readonly { readonly startsAt: string; readonly label: string }[];
  /** cellAt[stationIndex][timeIndex]. Built by grouping cells by stationId and preserving
   *  the server's array order within each station. Never by timestamp arithmetic. */
  readonly cellAt: readonly (readonly AvailabilityCell[])[];
}
export function buildGridModel(venue: VenueResponse, availability: AvailabilityResponse, kind?: StationKind): GridModel;
```

The time axis comes from the first station's cell sequence in the returned array order, and every
station is asserted to have the same length. Array order is the truth (`DESIGN.md`, and section 2 of
the milestone 2 spec): on a fall-back night two cells one hour apart carry the same local label, and
on a spring-forward night `startsAt + n * 30min` skips an hour. Never key on `localLabel`, never
index by timestamp arithmetic. Time **labels** come from a single memoised
`Intl.DateTimeFormat(locale, { timeZone: venue.timezone, hour: "2-digit", minute: "2-digit", hour12: false })`
applied to `Date.parse(startsAt)`. `localLabel` is used verbatim only in the booking recap and the
confirmation screen, where the full string is what you want.

Rendering, one component:

```tsx
const columns = isDesktop ? times.length : stations.length;
const rows    = isDesktop ? stations     : times;      // the outer grouping
```

DOM order always equals visual reading order, because the outer loop is whichever axis the current
orientation puts on rows. Placing cells with explicit `grid-column` / `grid-row` and leaving the DOM
in one fixed order would transpose the pixels without transposing the focus order, which breaks WCAG
2.4.3 and 1.3.2 on the mobile layout, the layout most of this audience will use.

Layout is CSS grid on the container with `grid-template-columns: repeat(var(--cols), var(--cell-w))`
and auto placement. Each `role="row"` wrapper carries `display: contents` so its children become
grid items of the outer grid, which is what lets one CSS grid carry a two-level DOM structure. This
is required for the ARIA structure below; `role="gridcell"` must be owned by a `role="row"`.

`isDesktop` comes from `useSyncExternalStore` over `matchMedia("(min-width: 768px)")`, not from a
resize listener and not from a `useEffect` that sets state after mount. The store subscribe function
is the media query's `change` event and the snapshot is `mql.matches`. This is the React 19 idiom
for an external browser value and it avoids the layout flash a mount effect produces.

### The six states, the playhead, and range selection

Cell states render exactly as `DESIGN.md` specifies. Two implementation notes:

- The stripe and crosshatch fills are CSS `repeating-linear-gradient` background images on the cell,
  defined once each as a utility class in `index.css`, not as inline styles on 360 elements.
- Cells are memoised: `const Cell = memo(GridCell)`, with props narrowed to `(state, isSelected,
  isRovingFocus, label, onSelect)`. There are up to 15 x 48 = 720 of them, and selection changes
  affect at most `maxSlots` of them. Without memoisation, every hover-free keyboard arrow press
  re-renders the whole grid and INP goes with it. This is not premature optimisation, it is the one
  place in the app where the node count justifies it. There is no React Compiler in this repo (no
  `babel-plugin-react-compiler` in the build), so the memo is explicit.

**The playhead** is one absolutely positioned element inside the grid's scroll container, rendered
only when the viewed `businessDate` contains `now`. Its offset:

```
i    = index of the cell in the time axis where startsAt <= now < endsAt   (found by scan, not by math)
frac = (now - Date.parse(cell.startsAt)) / (Date.parse(cell.endsAt) - Date.parse(cell.startsAt))
offset = (i + frac) * (cellSize + gap)
```

The index comes from scanning the array; only the sub-cell fraction uses timestamps, and that is
exact across a DST boundary because it divides by the cell's own real duration. It updates on the
same one-second tick the countdown uses, and it moves 40px per 30 minutes, which is roughly one
pixel per 45 seconds. Under `prefers-reduced-motion` the draw-in animation is dropped and the
element renders at its final position, per the motion budget.

**Range selection** lives in `/book`'s component state as `{ stationId, startIndex, slotCount }`,
not in search params, because it changes on every tap and a history entry per tap is hostile. It
becomes a search param only when the user commits by pressing "Hold this slot", which navigates to
`/book/$stationId?date&start&slots`.

Selection rules, all in `lib/grid.ts` as pure functions so they are testable without a DOM:

```ts
export function selectRange(model: GridModel, stationIndex: number, startIndex: number, station: StationSummary): Selection | null;
export function growRange(model: GridModel, selection: Selection, delta: 1 | -1, station: StationSummary): Selection;
```

- Tapping a `free` cell selects `station.minSlots` cells starting there, extending forward through
  the array. If any of those cells is not `free`, or the array runs out before `minSlots` cells, the
  tap is rejected and a toast says why. A station whose minimum run does not fit cannot be booked
  there, and saying so immediately is better than a 422 after the user types their name.
- `+30` extends by one array index, clamped by `station.maxSlots`, by the end of the array, and by
  the next cell being `free`.
- `-30` shrinks by one, clamped by `station.minSlots`.
- Adjacency is **array adjacency**, always. `DESIGN.md` forbids `startsAt + n * gridMinutes` and so
  does the milestone 2 spec, for the DST reason above.

Price in the selection bar is `priceBooking(station, venue.gridMinutes, slotCount)` from
`@playstop/engine`, labelled "estimated" until the hold's `quoteMinor` arrives, then `quoteMinor`,
and the confirm response's `totalMinor` is what the confirmation screen shows. That is three sources
of truth in ascending order of authority and `DESIGN.md` is explicit about the order.

`noUncheckedIndexedAccess` is on, so every `cells[i]` is `T | undefined`. Handle it with an early
return, not with `!`.

### Accessibility semantics

The grid is not a shadcn component, so its semantics are entirely this spec's responsibility.

**Structure:**

```
<div role="grid" aria-label="Availability for Saturday 9 August" aria-rowcount aria-colcount>
  <div role="row">                               <!-- display: contents -->
    <div role="columnheader" aria-sort="none">   <!-- sticky -->
  <div role="row">
    <div role="rowheader">                       <!-- station name (desktop) or time (mobile) -->
    <button role="gridcell" ...>   or   <div role="gridcell" aria-disabled="true" ...>
```

Header cells swap between `columnheader` and `rowheader` with the orientation, which falls out of
the same projection, since the outer loop already changed.

**Keyboard.** The grid is exactly one Tab stop. A roving `tabindex` puts `0` on one cell and `-1` on
every other cell **including the non-free ones**. Arrow keys move the roving index by one in the
visual direction (which, after transposition, is the same as the array direction on the relevant
axis). `Home` and `End` go to the first and last cell in the current row; `Ctrl+Home` and `Ctrl+End`
go to the first and last cell of the grid. `Enter` and `Space` select, and do nothing on a non-free
cell.

`DESIGN.md` says non-free cells are "non-focusable gridcells". Read that as "not in the tab order",
which is what the roving tabindex in the very next sentence implies, and which is the only reading
that works: a grid whose disabled cells cannot be reached by arrow keys is a grid a screen reader
user cannot read. `aria-disabled` (as opposed to the `disabled` attribute) exists precisely to keep
an element reachable while marking it unavailable, and that is the semantics to build.

**Announcement, given colour is never the only signal.** Every cell has an `aria-label` in
`DESIGN.md`'s format: `"19:30, PS5-2, booked"`, `"19:30, PS5-2, free, 240 rupees per hour"`. The
state word is in the label, so a screen reader user gets the state from the text and a sighted user
gets it from the texture (stripes, crosshatch, solid, dashed, outlined), with hue as reinforcement
only. The always-visible legend reproduces each texture next to its word, which serves both.

Selection changes announce through one `aria-live="polite"` region near the selection bar:
"Selected PS5-2, 19:30 to 21:00, 3 slots, 920 rupees estimated." Roving focus does **not** announce
through the live region; the focused cell's own label does that job, and doubling it makes the grid
unusable with a screen reader.

**Targets.** 44 x 44 CSS px minimum on mobile, 40 x 48 on desktop, per `DESIGN.md`, which clears
WCAG 2.2 AA's 24 x 24 requirement with room to spare. Do not shrink for density.

**Focus.** 2px go-green outline with 2px offset on every focusable element in both themes. The
sticky headers and the sticky selection bar must not obscure a focused cell (WCAG 2.2 AA 2.4.11):
scroll the roving focus into view with `scrollIntoView({ block: "nearest", inline: "nearest" })` and
give the scroll container `scroll-padding` equal to the sticky header and footer sizes. That one CSS
property is the whole fix and it is easy to forget.

---

## 8. Cold start

The API is a Render free service that spins down after 15 minutes idle. The first request of a
session can take 30 to 60 seconds. The client must not look broken for a minute.

1. **`preconnect`.** In `index.html`, `<link rel="preconnect" href="https://...onrender.com"
   crossorigin>` against the production API origin. It saves the DNS, TCP, and TLS round trips to
   Singapore, which is roughly 300 to 500ms from India before the server has done anything.

2. **A long timeout, only where it is needed.** The default per-request timeout in `lib/api.ts` is
   90 seconds. That is absurd for a healthy API and correct for a sleeping one. It is a ceiling, not
   a wait: a warm API answers in under a second and the timeout never fires.

3. **Wake it as early as possible.** The root route's loader fires the venue query. That request is
   the wake-up call and it happens before the user has picked a date, so the spin-up overlaps with
   the user reading the landing page. Do not add a separate `/health` ping; the venue call already
   does the job and a second request just doubles the cold-start cost.

4. **Say what is happening, after three seconds and not before.** The skeleton renders immediately.
   A message underneath it is hidden by default and revealed with a pure CSS delayed transition
   (`opacity: 0; animation: playstop-reveal 200ms linear 3s forwards`), so no timer, no state, and
   no re-render is involved:

   > Waking the booking server. It sleeps after 15 minutes idle, so this first load can take up to
   > a minute. Later pages are instant.

   At 25 seconds a second line appears the same way: "Still waking. Hang on." Naming the free tier
   is the right call for a portfolio repo: it reads as a known tradeoff rather than a slow app.
   Under `prefers-reduced-motion` the reveal is a plain `opacity` step, which the `animation`
   already is (there is no movement), so no special case is needed.

5. **Retry through the 502.** Render answers 502 while the instance boots, so a cold start can look
   like an error before it looks like a wait. The query retry policy (three attempts, exponential
   to 8 seconds, 5xx only) covers it, and the skeleton stays up the whole time because a retrying
   query is still `pending`.

6. **After all retries fail**, the grid area shows a full-width error state with a "Try again"
   button wired to `refetch()`, not a toast. A toast that vanishes leaves an empty page behind it.

Nothing about this is specific to the grid, so the delayed-reveal message is part of the shared
skeleton component and both the landing page and the grid get it.

---

## 9. Degraded mode

`availability.degraded === true` means Redis was unreachable, so held cells were reported as `free`.
Two consequences, both visible.

**On the grid,** an amber shadcn `Alert` directly above it, with `DESIGN.md`'s wording: "Live holds
are unavailable right now. A slot shown free may already be held." It is a banner, never a seventh
cell texture, and `DESIGN.md`'s "Do NOT" list says so explicitly. The alert appears and disappears
with the flag on each refetch, and it is not dismissible: a dismissed warning that is still true is
a lie.

**On the hold attempt,** `POST /holds` will answer 503 `HOLD_UNAVAILABLE`. That is not a failure to
book, and the flow must not treat it as one. The milestone 2 spec is explicit: confirm without a
`holdId` is legal and the system never refuses to book because Redis is down. So:

1. `POST /holds` returns 503 `HOLD_UNAVAILABLE`.
2. Write the attempt record with `hold: null`, keeping the freshly generated idempotency key.
3. Navigate to `/book/$stationId` exactly as on success.
4. The panel renders **no countdown and no progress bar** (there is nothing counting down), and a
   persistent amber `Alert` in its place: "We could not reserve this slot while you fill in your
   details. Someone else may confirm first. Your booking is only certain once you press Confirm."
5. Confirm sends the body **without** a `holdId` key at all (omitted, not `undefined`, per
   `exactOptionalPropertyTypes`).
6. A `SLOT_TAKEN` on that confirm is now more likely than usual, and it is handled exactly as in
   section 6. The user learns they lost after submitting, which is the degradation the API design
   accepted on purpose.

There is no client-side "wait and retry the hold" loop. If Redis is down the client cannot fix it,
and racing to hold on a timer would just burn the rate limit.

The same `HOLD_UNAVAILABLE` on `POST /holds/release` is swallowed silently. The hold either never
existed or will expire on its own inside the TTL, and there is nothing useful to tell a user who has
already navigated away.

---

## 10. The four screens

### `/` landing (`routes/index.tsx`)

Venue name in the display face, opening hours in mono derived from `openingHours` for the current
weekday (rendered "14:00 to 02:00" when `close <= open`, never as an error), a station kind summary
counted from `venue.stations`, and a date picker. No hero illustration.

The date picker is a shadcn `Calendar` inside a `Popover`. Disabled days: before today in the venue
timezone, after `today + maxAdvanceDays`, every date in `blackoutDates`, and every weekday whose
`openingHours` entry is `null`. All four come from the venue query, so the picker cannot offer a
date the API will reject with `DATE_OUT_OF_RANGE`.

The `Calendar` pulls in `react-day-picker`, which is the heaviest component in the app and sits
behind a click. Load it with `React.lazy` inside the `Popover` content and a `Skeleton` fallback, so
it is not in the landing page's critical path. The default selected date and the "Tonight" shortcut
button both use `defaultBusinessDate(venue, now)`:

```ts
/** The business date a session is currently in, which at 01:00 is yesterday, not today. */
export function defaultBusinessDate(venue: VenueResponse, now: Date): string;
```

Implementation: format `now` in `venue.timezone` with `Intl.DateTimeFormat("en-CA")` to get
`YYYY-MM-DD` and `HH:mm`. Take yesterday's `openingHours` entry; if it exists and `close <= open`
(the session crosses midnight) and the current local time is before that `close`, return yesterday.
Otherwise return today. A player standing in the venue at 00:30 gets tonight's grid, not tomorrow's
empty one. This is a pure function and it gets a test.

Selecting a date navigates to `/book?date=...`.

### `/book` grid (`routes/book.tsx`)

Date stepper (`< 2026-08-09 >`, mono) and the same picker, the `ToggleGroup` kind filter, the state
legend, the grid, the sticky selection bar, and `<Outlet/>` for the hold panel.

- `closed !== null`: full-grid empty state naming the reason in plain words ("Closed on Mondays",
  "Closed for a private event", "No bookable hours on this date") with the date stepper still live.
- `degraded`: section 9's alert above the grid.
- Loading: `Skeleton` rows in the grid's exact geometry, sized from `venue.stations.length` and 24
  columns, so the layout does not shift when data lands (CLS).
- Changing `kind` changes a search param, which changes the query key, which refetches. Do not
  filter client side: the API takes `kind` and filtering server side keeps the payload small.
- The selection bar is a sticky bottom bar below `md` and a bottom-right card above, with the one
  shadow in the app. Its primary button fires the `createHold` mutation described in section 5.

### `/book/$stationId` hold panel (`routes/book.station.tsx`)

A `Drawer` below `md`, a `Dialog` at `md` and above, rendered over the still-mounted grid. Contents:
range recap, countdown (or degraded alert, or expired state, or resume prompt: four mutually
exclusive states from section 5's table), player form, confirm button.

The form is a native `<form action={...}>` driven by `useActionState`. React 19's form action gets
the pending state, the reset behaviour, and the progressive-enhancement shape for free, and it keeps
the submit handler out of an `onClick`. Field validation before sending: parse the assembled body
with `createBookingRequestSchema` from `@playstop/engine` and surface `flatten().fieldErrors` inline.
The client parses the same schema the server does, which is the whole point of sharing it, and it
means `VALIDATION_FAILED` from the server should be unreachable and is therefore reported when it
happens.

**Party size.** `DESIGN.md` lists the form as "name required, email/phone optional" and does not
mention party size, but `createBookingRequestSchema` requires it and the server validates it against
`station.capacity`. Add a small stepper or `Select` bounded by `1..station.capacity`, defaulted to 1,
and hidden entirely when `capacity === 1` (a solo racing sim). Flagged in section 15.

On 201: `setQueryData(keys.booking(id), booking)`, invalidate availability, clear the attempt
record, `navigate({ to: "/booking/$bookingId", params: { bookingId: booking.id }, search: { code: booking.confirmationCode }, replace: true })`.
`replace: true` matters: the back button from the confirmation must not return to a hold panel whose
hold no longer exists.

### `/booking/$bookingId` confirmation (`routes/booking.tsx`)

Loads from the cache seeded above, or fetches with `?code=` when the URL was pasted or reloaded.

The confirmation code sits in a bordered `<code>` block at 24px mono with a copy button
(`navigator.clipboard.writeText`, with a `Sonner` confirmation and a visible fallback that selects
the text when the clipboard API is unavailable or blocked). Tell the user plainly that this is the
one thing to keep, because it is both the receipt and the only credential for cancelling.

Booking recap uses `localLabel` for the human-readable start, `totalMinor` for the authoritative
price, and the station name and kind from the response (not from the venue query, so a cancelled or
retired station still renders correctly).

Cancel is a destructive `Button` opening a `Dialog` whose confirm fires `cancelBooking(id, code)`.
On success, `setQueryData` with the returned cancelled booking and invalidate availability. Hide the
cancel button when `status === "cancelled"` or when `startsAt` is in the past, which is the same
condition the server enforces with `BOOKING_NOT_CANCELLABLE`.

---

## 11. Performance budget, and how to hold it

**Budget, gzipped, for the initial route (`/`):**

| Asset | Budget | Note |
|---|---|---|
| JS, entry chunk | 165 KB | React 19 + react-dom (~45), router (~14), query (~13), zod (~14), Radix primitives in use (~20), shadcn/cva/clsx/tw-merge (~5), app code (~25). Measured headroom, not a target to fill. |
| CSS | 20 KB | Tailwind v4 emits only used utilities. |
| Fonts | 160 KB | 8 woff2 files, latin subset only. Counted separately because they are cached across routes and not render blocking. |

Lazy, not in the entry chunk: `react-day-picker` (behind the Popover click), `vaul`/`Drawer` and
`Dialog` (route-level `lazyRouteComponent` on `/book/$stationId`), `/booking/$bookingId` entirely,
`sonner` (imported by the root but small enough to leave), and both devtools packages, which are
imported behind `import.meta.env.DEV` so Rollup drops them from the production build.

**Holding the budget:** the build order's final step runs `pnpm --filter @playstop/web build` and
records the printed gzip sizes in the web README. `vite build` prints them for free, so there is no
new dependency and no CI plumbing. When a chunk crosses its budget, the fix is a lazy boundary, not
a bigger budget. Run `npx vite-bundle-visualizer` (no install) when a number surprises you.

**Core Web Vitals, at p75:**

- **LCP 2.5s.** The landing page's LCP element is the venue name in Saira SemiCondensed 700, so
  preload exactly that one woff2 and nothing else. Every other face is `font-display: swap`. Self
  host through fontsource; no third-party font origin, which also means no extra connection to
  warm. `/book`'s LCP element is the grid, which depends on the API, so the skeleton must occupy the
  same geometry from the first paint (see CLS) and cold start is handled in section 8.
- **INP 200ms.** The grid is the only INP risk: 720 memoised cells, selection state that touches at
  most `maxSlots` of them, and no layout thrash on arrow keys (one `scrollIntoView` per key press).
  The one-second countdown tick re-renders only the panel's countdown subtree, not the grid, because
  the tick state lives in the countdown component. Do not lift it.
- **CLS 0.1.** Grid geometry comes from `venue.stations.length` before availability arrives, so the
  skeleton and the real grid are the same size. Every image (there are almost none) carries explicit
  dimensions. The cold-start message is revealed inside a fixed-height container so its appearance
  moves nothing.

**Theme.** Light is default, dark via `.dark` on `<html>`, per `DESIGN.md` and the shadcn
convention. Set the class from `prefers-color-scheme` in a tiny inline script in `index.html` before
first paint so there is no flash, and let a toggle override it into `localStorage`. This is the one
inline script in the app.

---

## 12. Accessibility checklist (WCAG 2.2 AA)

Not aspirational. Each line is checkable and step 9 of the build order checks them.

- Semantic landmarks: one `<header>` with the wordmark, one `<main>` per screen, one `<h1>` per
  screen, no skipped heading levels.
- Every pointer path has a keyboard path: the grid (roving tabindex plus Enter/Space), the date
  stepper (buttons), the picker (Calendar's own keyboard support), the steppers, the copy button.
- Focus is always visible and never obscured by the sticky header or selection bar (`scroll-padding`
  on the grid container, section 7).
- Targets are at least 24 x 24 CSS px everywhere and 44 x 44 in the grid on mobile.
- Colour is never the only signal: six cell states each carry a texture or structural cue, and the
  legend reproduces every texture beside its word.
- Live regions: one polite region for selection changes, one polite region for countdown milestones
  (60s, 20s, 0). No assertive regions anywhere; nothing in this flow justifies interrupting.
- The `Dialog` and `Drawer` come with shadcn's focus trap and restore. Verify focus returns to the
  "Hold this slot" button after the panel closes.
- Form fields use real `<label for>`; errors are linked with `aria-describedby` and marked
  `aria-invalid`; the error text is red **and** carries an icon and words.
- `prefers-reduced-motion`: kills the grid mount animation and the final-20s pulse entirely, keeps
  the countdown bar as stepped width updates and the colour changes. This is `DESIGN.md`'s motion
  budget verbatim.
- No positive `tabindex` anywhere. No `div` with `onClick`. No ARIA where a native element exists,
  with the grid as the deliberate exception, because no native element expresses a 15 x 24
  transposable selectable grid.

---

## 13. Testing

Be honest about what earns an automated test in a four-screen client with no browser tooling in the
repo, no jsdom, and no Playwright.

**What gets tested, with `node --test`:** every pure function in `lib/grid.ts`, plus the error
parsing in `lib/api.ts` against a stubbed `fetch`. These are the places where a bug is silent, where
the DST and adjacency rules live, and where a mistake produces a wrong booking rather than a visible
glitch.

```
apps/web/package.json:
  "test": "node --experimental-strip-types --test \"src/lib/*.test.ts\""
```

Node 22 needs the flag; Node 24 runs `.ts` without it. Type stripping cannot handle enums or
namespaces, and this codebase has neither. It also does not resolve the `@/` alias, which is why
`lib/grid.ts` imports only relative paths and `@playstop/types`.

The cases, ten in total:

1. `buildGridModel` groups a flat cell array into per-station rows in server order.
2. `buildGridModel` on a fall-back night keeps both 01:30 cells as separate, adjacent entries.
3. `buildGridModel` on a spring-forward night produces a shorter time axis with no gap in the array.
4. `selectRange` rejects a start where the next `minSlots - 1` cells are not all `free`.
5. `selectRange` rejects a start too close to the end of the array to fit `minSlots`.
6. `growRange` clamps at `maxSlots`, at the array end, and at the first non-free cell.
7. `defaultBusinessDate` at 00:30 local returns yesterday for a venue whose session crosses midnight.
8. `defaultBusinessDate` at 15:00 returns today.
9. `request` turns a structured 409 body into an `ApiRequestError` with the right `code` and
   `requestId`.
10. `request` turns a 502 with an HTML body into an `ApiRequestError("INTERNAL")` rather than
    throwing a `SyntaxError`.

**What does not get an automated test, and why.** Everything else: rendering, the router, the
mutations, the countdown display, the panel state machine. Adding jsdom plus Testing Library plus a
transform for four screens is more configuration than coverage, and the tests it would produce
(assert a button exists, assert a class was applied) fail for the wrong reasons and pass while the
flow is broken. The flow's real risks are timing races against a live API, and the tools that catch
those are Playwright against a running backend and a human clicking, in that order.

**Recommendation for what comes after this milestone:** one Playwright spec, not a suite, covering
the single critical path (pick a date, pick a cell, hold, confirm, land on the code, cancel) plus
`@axe-core/playwright` on each of the four screens. That earns its keep because it also becomes the
smoke test for the deployed site. Add it when the flow stops changing daily, not before. Until then,
the manual verification is: run the API against `playstop_dev`, seed it, and walk the flow in two
browser windows at once to watch a rival hold turn a cell to stripes.

**Verification during the build:** every build-order step ends in something runnable, and
`pnpm typecheck && pnpm lint && pnpm --filter @playstop/web test && pnpm --filter @playstop/web build`
is the gate for the whole milestone.

---

## 14. Build order

Each step is independently verifiable and depends only on those above it.

**Step 1. Dependencies, tokens, and the two prerequisite one-liners.**
Add the dependencies from section 1. Apply section 0's two changes. Run `npx shadcn@latest init`
against this package (Vite, Tailwind v4, `@/` alias, `cssVariables: true`) and confirm
`components.json` points `ui` at `@/components/ui` and `utils` at `@/lib/utils`. Write `index.css`:
`@import "tailwindcss"`, `@custom-variant dark (&:is(.dark *))`, the `@theme` block from `DESIGN.md`
verbatim, the shadcn variable mapping onto those tokens in `:root` and `.dark`, the fontsource
imports, and the two texture utility classes (amber stripes, steel crosshatch).
**Done when:** `pnpm --filter @playstop/web build` succeeds, the printed gzip sizes are recorded, and
`grep -ri luxon apps/web/dist` finds nothing.

**Step 2. shadcn components, all at once.**
`npx shadcn@latest add button badge alert calendar popover dialog drawer form input label progress
skeleton sonner toggle-group select`. Do not hand edit anything under `components/ui/`; theme
through the CSS variables only.
**Done when:** a scratch page renders one of each in both themes with the `DESIGN.md` colours, and
the measured contrast pairs from `DESIGN.md` hold (spot check three with a contrast checker).

**Step 3. `lib/api.ts`.**
Both error classes, the `request` function, the seven callers, and the `errorPresentation` record
typed as `Record<ErrorCode, ErrorPresentation>` so the compiler enforces exhaustiveness.
**Done when:** the two `lib/api.test.ts` cases pass, and a manual `getVenue()` from the browser
console against a running API returns a parsed `VenueResponse`.

**Step 4. `lib/query-client.ts` and the router shell.**
Key factory, `queryOptions` builders, `QueryClient` defaults, `main.tsx`, `router.tsx` with Sentry
and the `Register` declaration, `routes/root.tsx` with the wordmark, `Outlet`, `Toaster`, and the
root `errorComponent`.
**Done when:** the app boots to an empty root with the header, and the router devtools show the
route tree in development.

**Step 5. `/` landing.**
Venue query in the root loader, opening hours, station summary, lazy Calendar with all four disabled
sets, `defaultBusinessDate`, navigation to `/book`.
**Done when:** cases 7 and 8 of the test list pass, a blackout date is unpickable, and the cold-start
message appears after three seconds against a sleeping API. **This is where the cold-start behaviour
is proven; do it here rather than after the grid, because the landing page is the first request.**

**Step 6. `lib/grid.ts` and the grid, read only.**
`buildGridModel`, the availability query with polling, both orientations, the six cell states with
their textures, the legend, the playhead, the skeleton, the `closed` and `degraded` states. No
selection yet.
**Done when:** test cases 1, 2, and 3 pass; the grid renders the seeded venue's 15 stations across a
midnight-crossing session; resizing across 768px transposes it with the DOM order following; the
`--with-dst-venue` venue renders correctly on both transition dates; and a second browser window
confirming a booking turns a cell solid within 20 seconds. **This step holds the hard thinking. Do
not proceed until the DST dates render right.**

**Step 7. Selection, and the hold.**
`selectRange`, `growRange`, roving tabindex and the full keyboard map, the selection bar with the
estimated price, the `createHold` mutation, the attempt record, and navigation to the panel route.
**Done when:** test cases 4, 5, and 6 pass; a hold turns the cells amber in a second window within
20 seconds; and every keyboard interaction in section 7 works with the mouse unplugged.

**Step 8. The hold panel and confirm.**
Drawer/Dialog, all four panel states from section 5, the countdown derived from `expiresAt`, the
form with `useActionState`, the frozen body and the reused idempotency key, all three release paths,
and the complete section 6 error mapping.
**Done when:** every one of these is demonstrated by hand and pasted into the PR: expiry while
typing keeps the typed name; reload mid-hold resumes the countdown without a new hold; a hold
released on back navigation frees the cell in the other window; `HOLD_EXPIRED` and `SLOT_TAKEN`
produce visibly different screens; and a confirm retried after killing the API mid-request produces
one booking, not two. **That last one is the milestone's real gate.** Reproduce it by stopping the
API process between the POST leaving and the response arriving, restarting it, and pressing "Try
again".

**Step 9. Confirmation, cancel, and the accessibility pass.**
`/booking/$bookingId`, the code block and copy button, cancel with its dialog, then the section 12
checklist end to end: keyboard only through the whole flow, a screen reader over the grid and the
countdown, `prefers-reduced-motion` on, and an axe scan of each screen (browser extension is enough,
no dependency).
**Done when:** the checklist has no open items and the axe scan is clean on all four screens.

**Step 10. Budget, docs, deploy.**
Record the gzip sizes against section 11's budget. Update `apps/web/README.md` (screens, env vars,
the venue slug, the test command and its Node version requirement) and `docs/ARCHITECTURE.md`
(milestone 3 is done, shadcn and TanStack Router/Query are present, TanStack Table deliberately is
not). Set the new env vars in the Cloudflare Pages dashboard.
**Done when:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` is green and the deployed
site completes a real booking against the deployed API.

---

## 15. Deviations, gaps, and known costs

Things a reviewer should push back on if they disagree, listed rather than buried.

**Departures from the stated constraints**

1. **TanStack Table is not used.** Section 1 gives the reasoning. Nothing in these four screens is a
   table. This is the one mandated library this milestone declines, and it is declined in writing
   rather than silently.
2. **Routing is code based, not file based.** Four routes, no codegen artifact, and the agreed file
   layout has nowhere to put a generated route tree.

**Gaps in `DESIGN.md`, resolved here**

3. **Party size has no design.** The API requires it and validates it against station capacity, so
   the form needs a control. Specified in section 10 as a bounded stepper, hidden at capacity 1.
4. **"Non-focusable" cells.** Section 7 reads that as "not in the tab order" rather than "not
   reachable by arrow keys", because the literal reading makes the grid unreadable with a keyboard
   and contradicts the roving tabindex in the same paragraph.
5. **`DESIGN.md` does not cover the resume prompt, the degraded panel, or the unknown-outcome lock.**
   Three states the flow genuinely has. They reuse existing components (`Alert`, `Button`, panel
   copy) and introduce no new visual vocabulary.

**Expensive to implement as specified, flagged rather than quietly dropped**

6. **Eight font files.** Saira SemiCondensed 600 and 700, IBM Plex Sans 400/500/600, IBM Plex Mono
   400/500. Latin subset only, that is roughly 160 KB across eight requests. Dropping Saira 600 and
   Plex Sans 500 would save about 40 KB and two requests with, honestly, very little visible loss.
   Specified as written because `DESIGN.md` is binding; raise it if the budget bites.
7. **`display: contents` on the ARIA row wrappers.** Required to get `role="grid"` semantics out of
   a single CSS grid. Modern browsers keep `display: contents` elements in the accessibility tree
   (this was a real bug in older Chrome and Safari and it is fixed), but it is the one structural
   choice in the grid worth re-verifying with a screen reader in step 9 rather than trusting.
8. **The transposed mobile grid re-sorts the cell array.** One derived sort key, not a second
   component tree, but it does mean the DOM reorders on a breakpoint crossing, which is a full
   re-render of up to 720 nodes. It happens on orientation change only, which is rare, and the
   alternative (fixed DOM order with CSS placement) breaks focus order. The tradeoff is deliberate.

**Residual risks that no amount of client code removes**

9. **A confirm whose response is never seen.** The idempotency key makes a retry safe, and the
   client makes retry the default action. If the user chooses "Start over" instead, they may end up
   with two bookings, and the app tells them so in plain words. There is no read-by-player endpoint
   to check with, only read-by-code, and a booking whose code was never received cannot be looked
   up. The API's own spec names the same hole (the timeout-then-commit case in section 5).
10. **Clock skew** shifts the countdown by the user's clock error. Fails safe, not corrected.
11. **The rate limit is per instance and in memory** on the API, so it does not survive a Render
    restart. Nothing the client can or should do about it; noted so nobody debugs a phantom.
