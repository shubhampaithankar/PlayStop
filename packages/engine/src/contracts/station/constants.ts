import type { StationKind } from "@playstop/types";

// The four values are declared exactly once, in packages/types' hand-written
// StationKind union (also used by StationDoc and StationInput). `satisfies`
// fails the build the moment this array drifts from that union.
const STATION_KINDS = ["ps5", "ps3", "ps2", "racing-sim"] as const satisfies readonly StationKind[];

export { STATION_KINDS };