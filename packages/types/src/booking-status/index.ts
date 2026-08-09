// The one declaration of a booking's status. Used by BookingDoc, and passed
// straight to z.nativeEnum in packages/engine's wire schema.
export const BOOKING_STATUSES = {
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
} as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[keyof typeof BOOKING_STATUSES];
