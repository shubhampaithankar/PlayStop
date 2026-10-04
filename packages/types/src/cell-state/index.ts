export const CELL_STATES = {
  FREE: "free",
  HELD: "held",
  BOOKED: "booked",
  MAINTENANCE: "maintenance",
  PAST: "past",
  TOO_FAR_AHEAD: "too_far_ahead",
} as const;

export type CellState = (typeof CELL_STATES)[keyof typeof CELL_STATES];
