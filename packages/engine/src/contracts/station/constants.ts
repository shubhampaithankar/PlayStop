import type { StationKind } from "@playstop/types";

// Declared exactly once, in packages/types' hand-written StationKind union
// (also used by StationDoc and StationInput). `satisfies` fails the build the
// moment this drifts from that union.
export const STATION_KINDS = {
  PS5: "ps5",
  PS3: "ps3",
  PS2: "ps2",
  RACING_SIM: "racing-sim",
} as const satisfies Record<string, StationKind>;