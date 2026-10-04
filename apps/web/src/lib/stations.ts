// Real-data equivalents of the design mockup's fake-data.ts helpers
// (src/mockups/fake-data.ts): price display, time labels, and the
// aggregate status word a console card shows. Adjacency is checked on
// array order and endsAt/startsAt equality, never on startsAt arithmetic
// or localLabel dates -- DESIGN.md "Do NOT", DST nights break both.
import { CELL_STATES, STATION_KINDS, type StationKind } from "@playstop/types";
import { priceBooking } from "@playstop/engine";
import type { AvailabilityCell, StationSummary } from "@playstop/engine";

/** hourlyRateMinor is paise (100 minor units per rupee); see apps/api/src/seed.ts. */
export function hourlyRateRupees(station: StationSummary): number {
  return station.hourlyRateMinor / 100;
}

/** Client-side price for a chosen slotCount, rupees. Used only before a
 *  hold's `quoteMinor` exists (degraded mode, section 9) or before one is
 *  re-acquired; once a hold exists its `quoteMinor` is what renders, per
 *  DESIGN.md's "Do NOT show a client-computed price as final." */
export function bookingPriceRupees(
  station: Pick<StationSummary, "hourlyRateMinor">,
  gridMinutes: number,
  slotCount: number,
): number {
  return priceBooking(station, gridMinutes, slotCount) / 100;
}

/** "2026-11-01 01:30 EDT" -> "1:30 am". Pure string slicing, no Date parsing.
 *  Shared by timeLabelOf (a grid cell) and the confirmation screen (a
 *  booking response's localLabel, "label of the first cell", same shape). */
export function formatLocalLabelTime(localLabel: string): string {
  const [hourStr = "0", minute = "00"] = localLabel.slice(11, 16).split(":");
  const hour24 = Number(hourStr);
  const meridiem = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${meridiem}`;
}

export function timeLabelOf(cell: AvailabilityCell): string {
  return formatLocalLabelTime(cell.localLabel);
}

/** Formats an ISO instant as "8:30 pm" in the given timezone -- for when no
 *  cell's own localLabel covers the instant: endTimeLabel's closing-time
 *  fallback below, and the booking confirmation screen's end time, which
 *  has no cell at all (the booking response carries no grid). */
export function instantLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  })
    .format(new Date(iso))
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** The end-time label for a chosen start plus length, DESIGN.md's "8:30 pm
 *  to 10:30 pm". Prefers the boundary cell's own `localLabel` (a real cell
 *  the server already localized) over ever computing an instant. Only when
 *  a booking runs exactly to closing, with no cell after it, does this fall
 *  back to formatting the last booked cell's `endsAt` -- straight from the
 *  server, never `startsAt + n * gridMinutes` arithmetic. */
export function endTimeLabel(
  cells: readonly AvailabilityCell[],
  startsAt: string,
  slotCount: number,
  timezone: string,
): string {
  const startIndex = cells.findIndex((cell) => cell.startsAt === startsAt);
  if (startIndex === -1) return "";
  const boundaryCell = cells[startIndex + slotCount];
  if (boundaryCell) return timeLabelOf(boundaryCell);
  const lastCell = cells[startIndex + slotCount - 1];
  if (!lastCell) return "";
  return instantLabel(lastCell.endsAt, timezone);
}

/** One station's cells, in startsAt order. ISO 8601 UTC strings sort
 *  lexicographically the same as chronologically, so string compare is
 *  exact -- no Date parsing needed. */
export function cellsByStation(cells: readonly AvailabilityCell[], stationId: string): AvailabilityCell[] {
  return cells.filter((cell) => cell.stationId === stationId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** The caller's own hold range, from its booking attempt. */
export interface OwnHold {
  readonly stationId: string;
  readonly startsAt: string;
  readonly slotCount: number;
}

/** Per-viewer, view-only: flips the caller's OWN held cells to FREE so the
 *  grid and length options do not count the player against themselves. A
 *  HELD cell inside one's own hold range can only be one's own hold
 *  (acquireHold is atomic all-or-nothing and no two holds share a cell), so
 *  no holdId round-trip is needed. Only HELD flips: BOOKED, MAINTENANCE and
 *  PAST stay truthful. Returns the original array when nothing changed. The
 *  arbiter (Mongo) never sees this; see docs/conventions/booking-correctness.md. */
export function freeOwnHeldCells(cells: AvailabilityCell[], own: OwnHold | null): AvailabilityCell[] {
  if (own === null) return cells;
  const stationCells = cellsByStation(cells, own.stationId);
  const startIndex = stationCells.findIndex((cell) => cell.startsAt === own.startsAt);
  if (startIndex === -1) return cells;
  const ownStarts = new Set(stationCells.slice(startIndex, startIndex + own.slotCount).map((cell) => cell.startsAt));
  let changed = false;
  const next = cells.map((cell) => {
    if (cell.stationId !== own.stationId || !ownStarts.has(cell.startsAt) || cell.state !== CELL_STATES.HELD) {
      return cell;
    }
    changed = true;
    return { ...cell, state: CELL_STATES.FREE };
  });
  return changed ? next : cells;
}

/** Length of the free run starting at sortedCells[startIndex], stopping at
 *  the first non-free cell or the first adjacency gap. Exported: also used
 *  by lengthOptionsForStart to find how far a chosen start stays free. */
export function freeRunLengthFrom(sortedCells: readonly AvailabilityCell[], startIndex: number): number {
  let length = 0;
  for (let i = startIndex; i < sortedCells.length; i++) {
    const cell = sortedCells[i];
    if (!cell || cell.state !== CELL_STATES.FREE) break;
    if (length > 0) {
      const previous = sortedCells[i - 1];
      if (!previous || previous.endsAt !== cell.startsAt) break;
    }
    length++;
  }
  return length;
}

export type StationStatus =
  | { readonly kind: "free_now" }
  | { readonly kind: "free_from"; readonly timeLabel: string }
  | { readonly kind: "maintenance" }
  | { readonly kind: "booked_out" };

/** First cell at or after `fromIndex` that begins a run of at least
 *  `minSlots` consecutive free cells, or undefined if none does. */
function firstBookableCellFrom(
  cells: readonly AvailabilityCell[],
  fromIndex: number,
  minSlots: number,
): AvailabilityCell | undefined {
  for (let i = fromIndex; i < cells.length; i++) {
    if (freeRunLengthFrom(cells, i) >= minSlots) return cells[i];
  }
  return undefined;
}

/** `cells` must be one station's cells, already in startsAt order (see
 *  cellsByStation). A bookable run is counted in cells against
 *  station.minSlots, so the venue's gridMinutes never enters this. */
export function stationStatus(cells: readonly AvailabilityCell[], station: StationSummary): StationStatus {
  const firstNonPastIndex = cells.findIndex((cell) => cell.state !== CELL_STATES.PAST);
  if (firstNonPastIndex === -1) return { kind: "booked_out" };

  if (freeRunLengthFrom(cells, firstNonPastIndex) >= station.minSlots) {
    return { kind: "free_now" };
  }

  const laterCell = firstBookableCellFrom(cells, firstNonPastIndex + 1, station.minSlots);
  if (laterCell) {
    return { kind: "free_from", timeLabel: timeLabelOf(laterCell) };
  }

  const firstCell = cells[firstNonPastIndex];
  return firstCell?.state === CELL_STATES.MAINTENANCE ? { kind: "maintenance" } : { kind: "booked_out" };
}

/** DESIGN.md round 6: one card per KIND (PS5/PS3/PS2/Sim), not per station.
 *  Fixed display order; a kind with zero stations (never happens with the
 *  current seed) is simply omitted rather than rendered empty. */
const KIND_ORDER: readonly StationKind[] = [
  STATION_KINDS.PS5,
  STATION_KINDS.PS3,
  STATION_KINDS.PS2,
  STATION_KINDS.RACING_SIM,
];

export interface KindGroup {
  readonly kind: StationKind;
  readonly stations: StationSummary[];
}

export function groupStationsByKind(stations: readonly StationSummary[]): KindGroup[] {
  return KIND_ORDER.map((kind) => ({ kind, stations: stations.filter((station) => station.kind === kind) })).filter(
    (group) => group.stations.length > 0,
  );
}

/** "PS5 #4" -> 4, for picking the lowest-numbered unit. 0 (sorts first) for
 *  a name that doesn't carry a number -- never reachable with the seed's
 *  naming, but a station name is not a contract worth trusting blindly. */
function stationNumber(station: StationSummary): number {
  const match = /#(\d+)/.exec(station.name);
  return match?.[1] ? Number(match[1]) : 0;
}

/** The earliest cell in `stationCells` that starts a bookable run, or
 *  undefined if none does. Shared by kindGroupStatus (which only needs the
 *  label) and pickStationForKind (which needs to compare instants across
 *  stations) so both walk the same rule as stationStatus/startTimeCells. */
function earliestBookableCell(
  stationCells: readonly AvailabilityCell[],
  minSlots: number,
): AvailabilityCell | undefined {
  return firstBookableCellFrom(stationCells, 0, minSlots);
}

export type KindStatus =
  | { readonly kind: "free_now"; readonly count: number }
  | { readonly kind: "free_from"; readonly timeLabel: string }
  | { readonly kind: "maintenance" }
  | { readonly kind: "booked_out" };

/** The aggregate status a kind's card shows: how many units of the kind are
 *  free right now, or (if none) the earliest time any unit frees up, or
 *  (if none ever) whether the kind is out entirely maintenance vs full. */
export function kindGroupStatus(stations: readonly StationSummary[], cells: readonly AvailabilityCell[]): KindStatus {
  const perStation = stations.map((station) => ({
    station,
    stationCells: cellsByStation(cells, station.id),
  }));

  const freeNowCount = perStation.filter(
    ({ station, stationCells }) => stationStatus(stationCells, station).kind === "free_now",
  ).length;
  if (freeNowCount > 0) return { kind: "free_now", count: freeNowCount };

  let earliest: AvailabilityCell | undefined;
  for (const { station, stationCells } of perStation) {
    const candidate = earliestBookableCell(stationCells, station.minSlots);
    if (candidate && (!earliest || candidate.startsAt < earliest.startsAt)) earliest = candidate;
  }
  if (earliest) return { kind: "free_from", timeLabel: timeLabelOf(earliest) };

  const allMaintenance = perStation.every(
    ({ station, stationCells }) => stationStatus(stationCells, station).kind === "maintenance",
  );
  return allMaintenance ? { kind: "maintenance" } : { kind: "booked_out" };
}

/** The station a kind's card hands off to on tap: the lowest-numbered unit
 *  that is free now, or (if none is) the lowest-numbered unit among those
 *  tied for the earliest free-from time. Returns undefined only when the
 *  kind has no bookable unit at all, which the card never taps into (see
 *  kindGroupStatus's booked_out/maintenance). */
export function pickStationForKind(
  stations: readonly StationSummary[],
  cells: readonly AvailabilityCell[],
): StationSummary | undefined {
  const sorted = [...stations].sort((a, b) => stationNumber(a) - stationNumber(b));

  for (const station of sorted) {
    const stationCells = cellsByStation(cells, station.id);
    if (stationStatus(stationCells, station).kind === "free_now") return station;
  }

  let best: { station: StationSummary; startsAt: string } | undefined;
  for (const station of sorted) {
    const stationCells = cellsByStation(cells, station.id);
    const candidate = earliestBookableCell(stationCells, station.minSlots);
    if (candidate && (!best || candidate.startsAt < best.startsAt)) best = { station, startsAt: candidate.startsAt };
  }
  return best?.station;
}

export interface StartTimeCell {
  readonly cell: AvailabilityCell;
  /** True when a run of at least `minSlots` consecutive free cells begins
   *  at this cell -- the same rule `stationStatus` uses. */
  readonly startable: boolean;
}

/**
 * The cells DESIGN.md's "Pick a start time" screen renders: every cell from
 * the first non-past one through the last cell that can still start a
 * bookable run, each flagged whether it itself starts one. Past cells never
 * appear, and nothing after the last startable cell appears either --
 * DESIGN.md: the grid runs "through the last start that fits ... before the
 * booking window closes." `cells` must be one station's cells, already in
 * startsAt order (see cellsByStation).
 */
export function startTimeCells(cells: readonly AvailabilityCell[], minSlots: number): StartTimeCell[] {
  const firstNonPastIndex = cells.findIndex((cell) => cell.state !== CELL_STATES.PAST);
  if (firstNonPastIndex === -1) return [];

  let lastStartableIndex = -1;
  for (let i = firstNonPastIndex; i < cells.length; i++) {
    if (freeRunLengthFrom(cells, i) >= minSlots) lastStartableIndex = i;
  }
  if (lastStartableIndex === -1) return [];

  return cells.slice(firstNonPastIndex, lastStartableIndex + 1).map((cell, offset) => ({
    cell,
    startable: freeRunLengthFrom(cells, firstNonPastIndex + offset) >= minSlots,
  }));
}

/** The word a non-startable time cell shows beneath its line-through label. */
export function nonStartableWord(cell: AvailabilityCell): "taken" | "being fixed" {
  return cell.state === CELL_STATES.MAINTENANCE ? "being fixed" : "taken";
}

/**
 * Cells the server marked PAST for being too soon to book (lead time), not
 * for having already started. `computeAvailability` (packages/engine)
 * buckets both "already begun" and "starts within venue.leadTimeMinutes"
 * as CELL_STATES.PAST and `startTimeCells` above drops every leading PAST
 * cell, so a too-soon cell would otherwise vanish instead of rendering
 * disabled. The client tells the two apart by its own clock: a PAST cell
 * whose startsAt has not actually arrived yet was excluded for lead time,
 * not elapsed. `cells` must be one station's cells, already in startsAt
 * order (see cellsByStation). Empty for a future date, since nothing on a
 * future grid starts within the next `leadTimeMinutes`.
 */
export function leadBlockedCells(cells: readonly AvailabilityCell[], nowMs: number): AvailabilityCell[] {
  return cells.filter((cell) => cell.state === CELL_STATES.PAST && Date.parse(cell.startsAt) >= nowMs);
}

/** One row of the "Pick a start time" grid: a real startable/non-startable
 *  cell from startTimeCells, or a too-soon-to-book cell from
 *  leadBlockedCells. Screen 2 renders every kind with the same grey
 *  line-through tile, differing only in the word beneath the time. */
export type TimeCellRow =
  | { readonly kind: "cell"; readonly cell: AvailabilityCell; readonly startable: boolean }
  | { readonly kind: "too-soon"; readonly cell: AvailabilityCell };

/** `cells` must be one station's cells, already in startsAt order (see
 *  cellsByStation). Too-soon cells sort before startTimeCells' rows because
 *  they are, by construction, earlier than the first non-PAST cell. */
export function timeCellRows(cells: readonly AvailabilityCell[], minSlots: number, nowMs: number): TimeCellRow[] {
  const tooSoon: TimeCellRow[] = leadBlockedCells(cells, nowMs).map((cell) => ({ kind: "too-soon", cell }));
  const startable: TimeCellRow[] = startTimeCells(cells, minSlots).map(({ cell, startable }) => ({
    kind: "cell",
    cell,
    startable,
  }));
  return [...tooSoon, ...startable];
}

/** DESIGN.md's fixed length menu: 1, 2, or 3 hours, never more. */
const HOURS_OFFERED = [1, 2, 3] as const;

export interface LengthOption {
  readonly hours: number;
  readonly slotCount: number;
  /** priceBooking's minor-unit total, converted to rupees (paise / 100). */
  readonly priceRupees: number;
  readonly available: boolean;
  /** Set only when `available` is false: the time label of the first cell
   *  that blocks this length, i.e. DESIGN.md's "taken from 9:30 pm". */
  readonly blockedFromLabel: string | undefined;
}

/**
 * The three length buttons DESIGN.md's "How long?" screen renders for a
 * chosen start. `cells` must be one station's cells, already in startsAt
 * order (see cellsByStation). Hours beyond `station.maxSlots` are omitted
 * entirely, never shown as taken -- DESIGN.md offers at most 3 lengths and
 * a sim's 3-hour maxSlots (6 half-hour cells) is already the ceiling. Every
 * offered length shares one blocking time: the run starting at `startsAt`
 * is free up to the same cell regardless of which length you ask for.
 */
export function lengthOptionsForStart(
  cells: readonly AvailabilityCell[],
  startsAt: string,
  station: Pick<StationSummary, "maxSlots" | "hourlyRateMinor">,
  gridMinutes: number,
): LengthOption[] {
  const startIndex = cells.findIndex((cell) => cell.startsAt === startsAt);
  if (startIndex === -1) return [];

  const slotsPerHour = 60 / gridMinutes;
  const freeSlots = freeRunLengthFrom(cells, startIndex);
  // The start cell itself is not free, so no length can begin here. Return
  // no options rather than a full set of unavailable ones: with freeSlots
  // at 0 the "blocking" cell IS the start, which renders as the nonsense
  // "taken from 3:00 pm" against a 3:00 pm start. The caller shows the
  // reason from startCellState instead. Reachable via a link that aged out
  // (a start goes past while the tab sits open), never from screen 2.
  if (freeSlots === 0) return [];
  const blockingCell = cells[startIndex + freeSlots];
  const blockedFromLabel = blockingCell ? timeLabelOf(blockingCell) : undefined;

  const options: LengthOption[] = [];
  for (const hours of HOURS_OFFERED) {
    const slotCount = hours * slotsPerHour;
    if (slotCount > station.maxSlots) break; // ascending hours: the rest exceed it too
    const available = freeSlots >= slotCount;
    options.push({
      hours,
      slotCount,
      priceRupees: priceBooking(station, gridMinutes, slotCount) / 100,
      available,
      blockedFromLabel: available ? undefined : blockedFromLabel,
    });
  }
  return options;
}

/** State of the cell a chosen start points at, or undefined when no cell
 *  matches (a hand-edited or stale instant). Lets screen 3 say WHY a start
 *  it was handed is unusable, instead of showing dead length buttons. */
export function startCellState(
  cells: readonly AvailabilityCell[],
  startsAt: string,
): AvailabilityCell["state"] | undefined {
  return cells.find((cell) => cell.startsAt === startsAt)?.state;
}
