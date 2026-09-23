# Booking guardrails + OTP + messaging — design spec (v3)

Date: 2026-09-23. Status: approved. v1 mock-OTP + guardrails shipped; v2 was the architect
review; v3 is the product pivot: OTP becomes a REQUIRED gate on a customer-chosen channel
(email or sms), plus transactional messaging. Constraints from the user override two v2
recommendations:
- Portfolio project: KEEP OTP verification in Redis (showcase Redis), do NOT migrate to Mongo.
- Cannot use Resend, and free production SMS in India does not exist -> delivery is MOCK/logged
  for both channels via a pluggable adapter. No real provider wired now.

The double-booking arbiter (uniq_slot_claim + Mongo txn + idempotency insert) and the
concurrency proof stay untouched.

## Deliberate SLA change (documented, not silent)
OTP is now a hard, Redis-backed gate. Holds remain UX-only and still degrade open. But the OTP
gate is a REAL Redis dependency: if Redis is down, new bookings are blocked (no verification
possible). This narrows booking-correctness.md's "Redis never blocks a booking" to holds only.
Update docs/conventions/booking-correctness.md to state: holds degrade open; OTP verification is
a required Redis-backed gate and is a deliberate availability tradeoff.

## Decisions (locked)
- OTP verification store: REDIS, keyed by a server-issued `verificationId` (uuid), NOT holdId.
- OTP required on EVERY confirm. Remove the degrade-open skip and the no-holdId bypass.
- Channels: email OR sms, customer picks. Delivery MOCK (structured log) for both, behind one
  Notifier interface. `devCode` still returned on screen when MOCK_OTP=true.
- Messaging: confirmation (on confirm) + cancellation (on cancel) built now, fire-and-forget +
  dedupe-stamped. Nudge design-only (deferred).
- Guardrails (7-day window, 30-min lead, sibling fallback, cancel strikethrough): already shipped.

## Backend

### 1. OTP verification in Redis, decoupled to verificationId
Reuse the existing atomic `otpVerify` Lua (libs/redis/index.ts) and key scheme, rekeyed to
`ps:{APP_ENV}:{venueId}:otp:{verificationId}`. Hash fields: `{codeHash, channel, contact,
attempts, verified, requests}`. `codeHash = sha256(verificationId + ":" + code)`. TTL 600s
(fixed; no longer tied to a hold). Consume: DEL post-commit, fire-and-forget.
- `POST /otp/request` `{contact}` where contact is a discriminated union:
  `{channel:"email", email}` | `{channel:"sms", phone}` (email lowercased; phone reuse
  INDIA_PHONE_PATTERN + last-10 transform). Mint verificationId, HSET the hash, PEXPIRE 600s.
  Return `{verificationId, expiresAt, devCode?}` (devCode only when MOCK_OTP). Per-contact send
  cap (count via a Redis counter or requests field) -> OTP_TOO_MANY. Drop the old
  holdId/stationId/startsAt/slotCount body entirely. Also fire a MOCK send of the code through
  the Notifier (logged) so the send path is exercised.
- `POST /otp/verify` `{verificationId, code}` -> `{verified:true}` via the existing atomic Lua
  (rekeyed). Errors: OTP_INVALID (422), OTP_EXPIRED (410, key gone), OTP_TOO_MANY (429, cap 5).
- Confirm (`POST /bookings`): NEW required body field `verificationId` (uuid); `holdId` stays
  optional. Gate BEFORE the txn, AFTER the existing hold-verification block: load
  `otp:{verificationId}`, require `verified===1`. NO degrade-skip, NO holdId-based skip.
  Missing/unverified -> OTP_REQUIRED (403); key gone/expired -> OTP_EXPIRED (410).
  // ponytail: consume (DEL) runs post-commit, fire-and-forget, not inside the gate -- a lost
  // cell race must not burn the code. That makes this best-effort, not strict one-shot: within
  // the 10-minute TTL a verified id could gate a second confirm, bounded only by the
  // contact-match copy below and the unique-index arbiter at commit. Upgrade path: consume
  // atomically inside the OTP-verify Lua itself if a stronger one-shot guarantee is ever needed.
  Keep the existing OTP_REQUIRED/OTP_EXPIRED-abandons-idempotency exception so a client can
  verify then retry with the same key. Copy `channel`+`contact` from the verification hash onto
  the booking (authoritative, not client-submitted).

### 2. Booking doc + contracts
- `BookingDoc` (@playstop/types) + `bookingResponseSchema` gain: `contactChannel:"email"|"sms"`,
  `contact:string`, `confirmationSentAt|cancellationSentAt|nudgeSentAt: Date|null`.
- Rewrite `packages/engine/src/contracts/otp/index.ts`: contact discriminated union (above),
  `otpRequestSchema`={contact}, `otpVerifySchema`={verificationId, code}, response schemas.
  Parse never cast; controllers `.safeParse`.
- `createBookingRequestSchema` gains required `verificationId: uuid`.
- Error codes: reuse OTP_REQUIRED/OTP_INVALID/OTP_EXPIRED/OTP_TOO_MANY (already exist). Remove
  HOLD_UNAVAILABLE from the OTP paths (OTP no longer rides the hold's degrade path). SLOT_TOO_SOON
  and the window guard are unchanged from v2.

### 3. Messaging subsystem (new: apps/api/src/libs/notify/)
- `interface Notifier { send(msg:{to,subject,text}): Promise<void> }`.
- `emailNotifier` and `smsNotifier`: BOTH log a structured line now (no real provider; Resend is
  out, SMS not free). Same interface so a real adapter drops in later (one file). Mark with
  `// ponytail: log-only <channel> adapter; drop a provider client behind this interface when funded.`
- `notifyFor(channel)` returns the right adapter.
- Triggers, all fire-and-forget, all dedupe-stamped (never block or fail the booking, same spirit
  as post-commit releaseHold):
  - Confirmation: after runConfirmTransaction, beside releaseHold/consume. Guard: check-and-set
    `confirmationSentAt` via `updateOne({_id, confirmationSentAt:null},{$set:{...now}})`, send only
    if matched.
  - Cancellation: after the cancel transaction. Guard: `cancellationSentAt`.
  - Nudge: DESIGN-ONLY. Note the intended `POST /tasks/nudge` (shared-secret) swept by the
    keepalive ping, `nudgeSentAt` stamp, index `{status:1,nudgeSentAt:1,startsAt:1}`. Do NOT build.

### 4. Env
Keep MOCK_OTP (dev returns devCode; render.yaml already false in prod). Optional `MESSAGE_FROM`
(display "from" on logged messages). Do NOT add RESEND_API_KEY or any provider key. NUDGE secret
only when the nudge is built.

## Frontend (after backend)
- Details screen: capture CONTACT = a channel toggle (Email / SMS) + the matching input
  (email or India phone), validated client-side (server authoritative).
- OTP flow: on submit, POST /otp/request with the contact -> get verificationId + show the mock
  devCode -> POST /otp/verify -> confirm with verificationId (+ holdId if held).
- REMOVE the current degraded-Redis fall-through (503 -> confirm without OTP). OTP is now
  REQUIRED: if request/verify fails because the verification service is unavailable, show a clear
  "verification unavailable, try again" state, do NOT book without OTP.
- Cancel "book again" CTA: a cancelled booking shows the struck-through code (already done) PLUS a
  primary "Book again" action back to /book.
- Wordmark rethink: render the brand as ONE word, "PlayStop", not a two-colour PLAY/STOP split
  that reads as two words. Follow DESIGN.md; keep the STOP-square mark, apply cobalt as a single
  accent (whole word or just the mark), one weight. Justify it as one brand word.
- Client error map: OTP_* + SLOT_TOO_SOON copy already added; adjust for the required-gate wording.

## Tests
Backend: OTP request/verify/gate on Redis keyed by verificationId (wrong code, expired, attempt
cap, send cap, confirm without verify -> OTP_REQUIRED, confirm after verify -> 201, contact
mismatch -> OTP_REQUIRED); notifier triggers fire once (dedupe stamp); do NOT weaken the
concurrency proof; Redis-touching tests namespace + clean up. Frontend: contact validation
(email + phone), the required-gate no-bypass, sibling fallback unchanged.
