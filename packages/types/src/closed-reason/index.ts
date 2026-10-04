export const CLOSED_REASONS = {
  WEEKDAY_CLOSED: "weekday_closed",
  BLACKOUT: "blackout",
  NO_VALID_HOURS: "no_valid_hours",
} as const;

export type ClosedReason = (typeof CLOSED_REASONS)[keyof typeof CLOSED_REASONS];
