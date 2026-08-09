import type { ClosedReason } from "@playstop/types";

// Declared exactly once, in packages/types' ClosedReason union (also used by
// GridResult and AvailabilityResult). `satisfies` fails the build the moment
// this drifts from that union.
export const CLOSED_REASONS = {
  WEEKDAY_CLOSED: "weekday_closed",
  BLACKOUT: "blackout",
  NO_VALID_HOURS: "no_valid_hours",
} as const satisfies Record<string, ClosedReason>;