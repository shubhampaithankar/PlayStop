// Closed set, shared with the client, so apps/web gets an exhaustive union
// and the compiler catches an unhandled case when a new code is added.
const ERROR_CODES = [
  "SLOT_TAKEN",
  "SLOT_HELD",
  "HOLD_EXPIRED",
  "VENUE_NOT_FOUND",
  "STATION_NOT_FOUND",
  "PARTY_SIZE_EXCEEDS_CAPACITY",
  "SLOT_COUNT_OUT_OF_RANGE",
  "IDEMPOTENCY_KEY_REUSED",
  "REQUEST_IN_FLIGHT",
  "IDEMPOTENCY_KEY_REQUIRED",
  "SLOT_NOT_ON_GRID",
  "SLOT_OUT_OF_WINDOW",
  "SLOT_UNAVAILABLE",
  "DATE_OUT_OF_RANGE",
  "BOOKING_NOT_CANCELLABLE",
  "HOLD_UNAVAILABLE",
  "BOOKING_TIMEOUT",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "BOOKING_NOT_FOUND",
  "NOT_FOUND", // generic 404 for a route that matches no endpoint at all
  "INTERNAL",
] as const;

export { ERROR_CODES };