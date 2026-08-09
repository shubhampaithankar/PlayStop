import type { CellState } from "@playstop/types";

// Named keys so call sites read CELL_STATES.TOO_FAR_AHEAD rather than a bare
// string. The values are declared exactly once, in packages/types' hand-written
// CellState union: `satisfies` fails the build the moment this drifts from that
// union, replacing what used to be a runtime sync test.
//
// Shared between contracts (schema validation) and utils (state resolution
// logic), so it lives here rather than under either one.
export const CELL_STATES = {
  FREE: "free",
  HELD: "held",
  BOOKED: "booked",
  MAINTENANCE: "maintenance",
  PAST: "past",
  TOO_FAR_AHEAD: "too_far_ahead",
} as const satisfies Record<string, CellState>;

// `satisfies` above only checks that every value present is a valid CellState.
// It does NOT check the reverse: a member added to the union in packages/types
// would be silently missing here, and the Zod contract would then reject a
// legitimate value. This fails to compile if that happens, naming the gap.
type UncoveredCellState = Exclude<CellState, (typeof CELL_STATES)[keyof typeof CELL_STATES]>;
const _cellStatesAreExhaustive: [UncoveredCellState] extends [never]
  ? true
  : { MISSING: UncoveredCellState } = true;