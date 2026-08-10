# Booking correctness

The scarcity here is physical: a double-booked PS5 means two groups arrive for the same
console. These rules are not style preferences.

## Redis is UX, Mongo is truth

A Redis hold is an advisory soft reservation with a TTL. It makes the common case pleasant.
It is **not** proof a cell is free.

The unique partial index `uniq_slot_claim` on `(venueId, cellStart, stationId)` is the only
correctness backstop. Every design decision follows from that sentence:

- A Redis outage degrades the experience (more users see a conflict after clicking confirm)
  and never degrades correctness.
- The system never refuses to book because Redis is down. Refusing would turn a cache outage
  into a full booking outage.
- Availability reports `degraded: true` when Redis is unreachable, and held cells then show as
  free. Showing an optimistic `free` and taking a conflict beats showing everything as taken.

## A booking is all its cells or none

A booking spans one or more 30-minute cells. The booking document and one `slot_claims` row
per cell are written inside a single Mongo transaction, so a booking that loses the race on
any one cell leaves nothing behind. Test I proves this by deliberately conflicting on the
**middle** cell: a first-cell conflict would pass even with no transaction at all.

## Never trust a client-supplied instant

`startsAt` is validated against the server-side grid before anything else happens. Without
that check a client could book at 14:07 and slip between cells, defeating the unique index
entirely. This is trust-boundary validation and must not be simplified away.

## Idempotency

`Idempotency-Key` is required on confirm. The key is bound to a hash of the validated body, so
a retry carrying the same key with a different body is rejected rather than replayed. The
client must generate the key once per booking attempt and reuse it across retries, including
after a network failure where it never saw the response. Regenerating it on retry defeats the
mechanism and can double-book.

Full design in `docs/milestone-2-spec.md` sections 4 and 5.
