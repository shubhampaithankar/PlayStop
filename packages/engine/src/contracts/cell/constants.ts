import type { CellState } from "@playstop/types";

// The six values are declared exactly once, in packages/types' hand-written
// CellState union. `satisfies` fails the build the moment this array drifts
// from that union, replacing what used to be a runtime sync test.
const CELL_STATES = [
  "free",
  "held",
  "booked",
  "maintenance",
  "past",
  "too_far_ahead",
] as const satisfies readonly CellState[];

export { CELL_STATES };