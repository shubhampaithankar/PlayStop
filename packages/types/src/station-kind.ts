// The one declaration of a station's kind. packages/engine builds
// stationKindSchema (Zod, for wire validation) from this exact union via a
// `satisfies` check, so the two can never drift silently the way
// CellState/AvailabilityCell once did.
export type StationKind = "ps5" | "ps3" | "ps2" | "racing-sim";
