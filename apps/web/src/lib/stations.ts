import { CELL_STATES, STATION_KINDS, type StationKind } from "@playstop/types";
import { priceBooking } from "@playstop/engine";
import type { AvailabilityCell, StationSummary } from "@playstop/engine";

export function hourlyRateRupees(station: StationSummary): number {
  return station.hourlyRateMinor / 100;
}

export function bookingPriceRupees(
  station: Pick<StationSummary, "hourlyRateMinor">,
  gridMinutes: number,
  slotCount: number,
): number {
  return priceBooking(station, gridMinutes, slotCount) / 100;
}

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

export function cellsByStation(cells: readonly AvailabilityCell[], stationId: string): AvailabilityCell[] {
  return cells.filter((cell) => cell.stationId === stationId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export interface OwnHold {
  readonly stationId: string;
  readonly startsAt: string;
  readonly slotCount: number;
}

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

function stationNumber(station: StationSummary): number {
  const match = /#(\d+)/.exec(station.name);
  return match?.[1] ? Number(match[1]) : 0;
}

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
  readonly startable: boolean;
}

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

export function nonStartableWord(cell: AvailabilityCell): "taken" | "being fixed" {
  return cell.state === CELL_STATES.MAINTENANCE ? "being fixed" : "taken";
}

export function leadBlockedCells(cells: readonly AvailabilityCell[], nowMs: number): AvailabilityCell[] {
  return cells.filter((cell) => cell.state === CELL_STATES.PAST && Date.parse(cell.startsAt) >= nowMs);
}

export type TimeCellRow =
  | { readonly kind: "cell"; readonly cell: AvailabilityCell; readonly startable: boolean }
  | { readonly kind: "too-soon"; readonly cell: AvailabilityCell };

export function timeCellRows(cells: readonly AvailabilityCell[], minSlots: number, nowMs: number): TimeCellRow[] {
  const tooSoon: TimeCellRow[] = leadBlockedCells(cells, nowMs).map((cell) => ({ kind: "too-soon", cell }));
  const startable: TimeCellRow[] = startTimeCells(cells, minSlots).map(({ cell, startable }) => ({
    kind: "cell",
    cell,
    startable,
  }));
  return [...tooSoon, ...startable];
}

const HOURS_OFFERED = [1, 2, 3] as const;

export interface LengthOption {
  readonly hours: number;
  readonly slotCount: number;
  readonly priceRupees: number;
  readonly available: boolean;
  readonly blockedFromLabel: string | undefined;
}

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
  if (freeSlots === 0) return [];
  const blockingCell = cells[startIndex + freeSlots];
  const blockedFromLabel = blockingCell ? timeLabelOf(blockingCell) : undefined;

  const options: LengthOption[] = [];
  for (const hours of HOURS_OFFERED) {
    const slotCount = hours * slotsPerHour;
    if (slotCount > station.maxSlots) break;
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

export function startCellState(
  cells: readonly AvailabilityCell[],
  startsAt: string,
): AvailabilityCell["state"] | undefined {
  return cells.find((cell) => cell.startsAt === startsAt)?.state;
}
