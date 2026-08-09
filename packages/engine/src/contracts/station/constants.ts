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

// `satisfies` above only checks that every value present is a valid StationKind.
// It does NOT check the reverse: a member added to the union in packages/types
// would be silently missing here, and the Zod contract would then reject a
// legitimate value. This fails to compile if that happens, naming the gap.
type UncoveredStationKind = Exclude<StationKind, (typeof STATION_KINDS)[keyof typeof STATION_KINDS]>;
const _stationKindsAreExhaustive: [UncoveredStationKind] extends [never]
  ? true
  : { MISSING: UncoveredStationKind } = true;