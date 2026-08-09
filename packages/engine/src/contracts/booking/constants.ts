// Crockford base32, no ambiguous glyphs (I, L, O, U excluded).
const CONFIRMATION_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;

const PLAYER_NAME_MIN_LENGTH = 1;
const PLAYER_NAME_MAX_LENGTH = 80;

const PLAYER_PHONE_MIN_LENGTH = 5;
const PLAYER_PHONE_MAX_LENGTH = 32;
const PLAYER_PHONE_PATTERN = /^[+0-9 ()-]+$/;

const PARTY_SIZE_MIN = 1;
const PARTY_SIZE_MAX = 8; // station bound 1..capacity checked server-side

const BOOKING_STATUSES = {
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
} as const;

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