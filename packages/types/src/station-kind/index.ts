// The one declaration of a station's kind. packages/engine passes this
// straight to z.nativeEnum, so the wire schema and the type can never
// drift: there is nowhere left to declare a second, competing list.
export const STATION_KINDS = {
  PS5: "ps5",
  PS3: "ps3",
  PS2: "ps2",
  RACING_SIM: "racing-sim",
} as const;

export type StationKind = (typeof STATION_KINDS)[keyof typeof STATION_KINDS];
