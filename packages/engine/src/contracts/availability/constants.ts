import type { ClosedReason } from "@playstop/types";

// The three reasons are declared exactly once, in packages/types' ClosedReason
// union (also used by GridResult and AvailabilityResult). `satisfies` fails
// the build the moment this array drifts from that union.
const CLOSED_REASONS = ["weekday_closed", "blackout", "no_valid_hours"] as const satisfies readonly ClosedReason[];

export { CLOSED_REASONS };