import type { BookingStatus } from "@playstop/types";

// Crockford base32, no ambiguous glyphs (I, L, O, U excluded).
const CONFIRMATION_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;

const PLAYER_NAME_MIN_LENGTH = 1;
const PLAYER_NAME_MAX_LENGTH = 80;

const PLAYER_PHONE_MIN_LENGTH = 5;
const PLAYER_PHONE_MAX_LENGTH = 32;
const PLAYER_PHONE_PATTERN = /^[+0-9 ()-]+$/;

const PARTY_SIZE_MIN = 1;
const PARTY_SIZE_MAX = 8; // station bound 1..capacity checked server-side

// Declared exactly once, in packages/types' hand-written BookingStatus union
// (also used by BookingDoc). `satisfies` fails the build the moment this
// drifts from that union.
const BOOKING_STATUSES = {
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
} as const satisfies Record<string, BookingStatus>;

// `satisfies` above only checks that every value present is a valid
// BookingStatus. It does NOT check the reverse: a member added to the union
// in packages/types would be silently missing here. This fails to compile if
// that happens, naming the gap.
type UncoveredBookingStatus = Exclude<BookingStatus, (typeof BOOKING_STATUSES)[keyof typeof BOOKING_STATUSES]>;
const _bookingStatusesAreExhaustive: [UncoveredBookingStatus] extends [never]
  ? true
  : { MISSING: UncoveredBookingStatus } = true;

export {
  CONFIRMATION_CODE_PATTERN,
  PLAYER_NAME_MIN_LENGTH,
  PLAYER_NAME_MAX_LENGTH,
  PLAYER_PHONE_MIN_LENGTH,
  PLAYER_PHONE_MAX_LENGTH,
  PLAYER_PHONE_PATTERN,
  PARTY_SIZE_MIN,
  PARTY_SIZE_MAX,
  BOOKING_STATUSES,
};