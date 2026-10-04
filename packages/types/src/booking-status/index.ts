export const BOOKING_STATUSES = {
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
} as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[keyof typeof BOOKING_STATUSES];
