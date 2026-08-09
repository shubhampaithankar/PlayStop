const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Clients should send a UUID v4. 16 to 128 chars keeps the idempotency
// collection's _id bounded while giving room for any reasonable client
// token shape.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

// Shared across booking and hold requests: a session is at most 48 grid
// slots long, the per-station min/max is checked server-side on top of this.
const SLOT_COUNT_MIN = 1;
const SLOT_COUNT_MAX = 48;

export {
  OBJECT_ID_PATTERN,
  LOCAL_DATE_PATTERN,
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  SLOT_COUNT_MIN,
  SLOT_COUNT_MAX,
};
