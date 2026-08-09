// The one declaration of "why a business date has no cells". Used by
// GridResult and AvailabilityResult, and passed straight to z.nativeEnum in
// packages/engine's wire schema.
export const CLOSED_REASONS = {
  WEEKDAY_CLOSED: "weekday_closed",
  BLACKOUT: "blackout",
  NO_VALID_HOURS: "no_valid_hours",
} as const;

export type ClosedReason = (typeof CLOSED_REASONS)[keyof typeof CLOSED_REASONS];
