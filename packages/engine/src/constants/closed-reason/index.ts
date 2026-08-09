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

// `satisfies` above only checks that every value present is a valid ClosedReason.
// It does NOT check the reverse: a member added to the union in packages/types
// would be silently missing here, and the Zod contract would then reject a
// legitimate value. This line fails to compile if that happens, naming the gap.
type UncoveredClosedReason = Exclude<ClosedReason, (typeof CLOSED_REASONS)[keyof typeof CLOSED_REASONS]>;
const _closedReasonsAreExhaustive: [UncoveredClosedReason] extends [never]
  ? true
  : { MISSING: UncoveredClosedReason } = true;