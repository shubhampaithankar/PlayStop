import { CELL_STATES, STATION_KINDS, type StationKind } from "@playstop/types";
import type { AvailabilityCell } from "../availability/index.js";
import type { StationSummary } from "../../contracts/station/index.js";
import type { KindSummary } from "../../contracts/availability/index.js";

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

export function cellsByStation(cells: readonly AvailabilityCell[], stationId: string): AvailabilityCell[] {
  return cells.filter((cell) => cell.stationId === stationId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export interface OwnHold {
  readonly stationId: string;
  readonly startsAt: string;
  readonly slotCount: number;
}

export function freeOwnHeldCells(cells: readonly AvailabilityCell[], own: OwnHold | null): readonly AvailabilityCell[] {
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

export function firstBookableCellFrom(
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

export const KIND_ORDER: readonly StationKind[] = [
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

export function summarizeAvailability(
  stations: readonly StationSummary[],
  cells: readonly AvailabilityCell[],
): KindSummary[] {
  return groupStationsByKind(stations).map(({ kind, stations: kindStations }) =>
    summarizeKind(kind, kindStations, cells),
  );
}

function summarizeKind(
  kind: StationKind,
  stations: readonly StationSummary[],
  cells: readonly AvailabilityCell[],
): KindSummary {
  const scanned = [...stations]
    .sort((a, b) => stationNumber(a) - stationNumber(b))
    .map((station) => {
      const stationCells = cellsByStation(cells, station.id);
      return {
        stationId: station.id,
        status: stationStatus(stationCells, station).kind,
        earliest: earliestBookableCell(stationCells, station.minSlots),
      };
    });

  const freeNow = scanned.filter((entry) => entry.status === "free_now");
  const [firstFreeNow] = freeNow;
  if (firstFreeNow) {
    return { kind, status: "free_now", freeCount: freeNow.length, pickStationId: firstFreeNow.stationId };
  }

  let soonest: { stationId: string; cell: AvailabilityCell } | undefined;
  for (const { stationId, earliest } of scanned) {
    if (earliest && (!soonest || earliest.startsAt < soonest.cell.startsAt)) soonest = { stationId, cell: earliest };
  }
  if (soonest) {
    return { kind, status: "free_from", timeLabel: timeLabelOf(soonest.cell), pickStationId: soonest.stationId };
  }

  return scanned.every((entry) => entry.status === "maintenance")
    ? { kind, status: "maintenance" }
    : { kind, status: "booked_out" };
}
