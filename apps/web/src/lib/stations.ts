import { CELL_STATES } from "@playstop/types";
import { freeRunLengthFrom, priceBooking, timeLabelOf } from "@playstop/engine";
import type { AvailabilityCell, StationSummary } from "@playstop/engine";

export { cellsByStation, freeOwnHeldCells, groupStationsByKind, pickStationForKind, stationStatus, timeLabelOf } from "@playstop/engine";
export type { OwnHold } from "@playstop/engine";

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
