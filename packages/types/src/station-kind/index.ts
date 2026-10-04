export const STATION_KINDS = {
  PS5: "ps5",
  PS3: "ps3",
  PS2: "ps2",
  RACING_SIM: "racing-sim",
} as const;

export type StationKind = (typeof STATION_KINDS)[keyof typeof STATION_KINDS];
