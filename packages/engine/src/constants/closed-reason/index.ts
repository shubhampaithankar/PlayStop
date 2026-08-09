import type { ClosedReason } from "@playstop/types";

// Declared exactly once, in packages/types' ClosedReason union (also used by
// GridResult and AvailabilityResult). `satisfies` fails the build the moment
// this drifts from that union.
//
// Shared between contracts (schema validation) and utils/grid (the code that
// actually produces these reasons), so it lives here rather than under either
// one.
export const CLOSED_REASONS = {
  WEEKDAY_CLOSED: "weekday_closed",
  BLACKOUT: "blackout",
  NO_VALID_HOURS: "no_valid_hours",
} as const satisfies Record<string, ClosedReason>;
