// The one declaration of a cell's availability state. packages/engine passes
// this straight to z.nativeEnum, so the wire schema and the type can never
// drift: there is nowhere left to declare a second, competing list.
export const CELL_STATES = {
  FREE: "free",
  HELD: "held",
  BOOKED: "booked",
  MAINTENANCE: "maintenance",
  PAST: "past",
  TOO_FAR_AHEAD: "too_far_ahead",
} as const;

export type CellState = (typeof CELL_STATES)[keyof typeof CELL_STATES];
