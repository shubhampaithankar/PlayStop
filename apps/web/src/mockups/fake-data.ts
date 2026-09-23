// Static fake data for the design mockups (src/mockups/). Nothing here talks
// to the API or to grid.ts's real DST-safe adjacency logic -- it exists only
// so the booking flow has something realistic to render for a design review.
//
// ponytail: hand-authored patterns instead of a random generator. Nine
// literal characters per station is easier to eyeball and just as fake.

export type CellState = "free" | "held" | "booked" | "maintenance" | "past" | "too_far_ahead";

export type StationKind = "ps5" | "ps3" | "ps2" | "sim";

export interface MockStation {
  readonly id: string;
  readonly name: string;
  readonly kind: StationKind;
  readonly ratePerSlotRupees: number;
  /** What is on the station's screen right now; null = nothing playing.
   *  DATA GAP: no API field backs this yet. Design fiction, flagged. */
  readonly nowPlaying: string | null;
  /** One char per half-hour cell in the "live" window (indices 12-20,
   *  20:00-23:30): F free, H held, B booked, M maintenance. Before the
   *  window = past, after = too_far_ahead. */
  readonly livePattern: string;
}

export const STATIONS: readonly MockStation[] = [
  { id: "ps5-1", name: "PS5-1", kind: "ps5", ratePerSlotRupees: 150, nowPlaying: "EA FC 26", livePattern: "FFHHBBFFM" },
  { id: "ps5-2", name: "PS5-2", kind: "ps5", ratePerSlotRupees: 150, nowPlaying: "GTA VI", livePattern: "FFFHHBBFF" },
  { id: "ps5-3", name: "PS5-3", kind: "ps5", ratePerSlotRupees: 150, nowPlaying: null, livePattern: "MMMFFFFFF" },
  { id: "ps5-4", name: "PS5-4", kind: "ps5", ratePerSlotRupees: 150, nowPlaying: "Tekken 8", livePattern: "FBBBBFFFF" },
  { id: "ps5-5", name: "PS5-5", kind: "ps5", ratePerSlotRupees: 150, nowPlaying: null, livePattern: "FFFFFFFFF" },
  { id: "ps5-6", name: "PS5-6", kind: "ps5", ratePerSlotRupees: 150, nowPlaying: "Elden Ring", livePattern: "HHFFFBBFF" },
  { id: "ps5-7", name: "PS5-7", kind: "ps5", ratePerSlotRupees: 150, nowPlaying: "Spider-Man 2", livePattern: "FFBBFFFHH" },
  { id: "ps3-1", name: "PS3-1", kind: "ps3", ratePerSlotRupees: 100, nowPlaying: "God of War III", livePattern: "FFFHBFFFF" },
  { id: "ps3-2", name: "PS3-2", kind: "ps3", ratePerSlotRupees: 100, nowPlaying: "GTA V", livePattern: "BBBBBBBBB" },
  { id: "ps3-3", name: "PS3-3", kind: "ps3", ratePerSlotRupees: 100, nowPlaying: null, livePattern: "FFFFHHFFF" },
  { id: "ps2-1", name: "PS2-1", kind: "ps2", ratePerSlotRupees: 80, nowPlaying: "GTA San Andreas", livePattern: "FFFFFFFFF" },
  { id: "ps2-2", name: "PS2-2", kind: "ps2", ratePerSlotRupees: 80, nowPlaying: "WWE SmackDown!", livePattern: "FFFBBFFFF" },
  { id: "sim-1", name: "Racing sim 1", kind: "sim", ratePerSlotRupees: 250, nowPlaying: "Assetto Corsa", livePattern: "FFHHHFFFF" },
  { id: "sim-2", name: "Racing sim 2", kind: "sim", ratePerSlotRupees: 250, nowPlaying: "F1 25", livePattern: "BBFFFFFFH" },
  { id: "sim-3", name: "Racing sim 3", kind: "sim", ratePerSlotRupees: 250, nowPlaying: "Gran Turismo 7", livePattern: "FFFFFFFMM" },
];

/** Index of "now" for the mock: 20:00. */
export const NOW_INDEX = 12;
/** Index where too_far_ahead starts: last bookable start is 12:00 am. */
export const FAR_INDEX = 21;

/** Prices are shown per hour, in whole rupees. Rates are stored per half hour. */
export function hourlyRateRupees(station: MockStation): number {
  return station.ratePerSlotRupees * 2;
}

/** Cell index -> plain 12-hour label: "8:00 pm", "12:30 am". */
export function timeLabel12(cellIndex: number): string {
  const totalMinutes = (14 * 60 + cellIndex * 30) % (24 * 60);
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const meridiem = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

const LIVE_CODE: Record<string, CellState> = {
  F: "free",
  H: "held",
  B: "booked",
  M: "maintenance",
};

export function cellStateAt(station: MockStation, cellIndex: number): CellState {
  if (cellIndex < NOW_INDEX) return "past";
  if (cellIndex >= FAR_INDEX) return "too_far_ahead";
  const code = station.livePattern[cellIndex - NOW_INDEX];
  return (code ? LIVE_CODE[code] : undefined) ?? "free";
}

/** Consecutive free half-hour cells starting at cellIndex. */
export function freeSlotsFrom(station: MockStation, cellIndex: number): number {
  let count = 0;
  while (cellStateAt(station, cellIndex + count) === "free") count++;
  return count;
}

/** Whole hours bookable from cellIndex, capped at the 3-hour menu. */
export function maxHoursFrom(station: MockStation, cellIndex: number): number {
  return Math.min(3, Math.floor(freeSlotsFrom(station, cellIndex) / 2));
}

/** Aggregate of the cell states, for the console card's status words. */
export type StationStatus =
  | { readonly kind: "free_now" }
  | { readonly kind: "free_from"; readonly timeLabel: string }
  | { readonly kind: "maintenance" }
  | { readonly kind: "booked_out" };

export function stationStatus(station: MockStation): StationStatus {
  if (maxHoursFrom(station, NOW_INDEX) >= 1) return { kind: "free_now" };
  for (let cellIndex = NOW_INDEX + 1; cellIndex < FAR_INDEX; cellIndex++) {
    if (maxHoursFrom(station, cellIndex) >= 1) {
      return { kind: "free_from", timeLabel: timeLabel12(cellIndex) };
    }
  }
  return cellStateAt(station, NOW_INDEX) === "maintenance"
    ? { kind: "maintenance" }
    : { kind: "booked_out" };
}
