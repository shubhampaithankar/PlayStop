import { DateTime } from "luxon";
import type { ClosedReason, GridCell, GridResult, VenueSchedule } from "@playstop/types";
import { CLOSED_REASONS } from "@playstop/types";
import { MINUTES_PER_HOUR, MS_PER_DAY, MS_PER_MINUTE } from "../../constants/time/index.js";
import { LOCAL_LABEL_FORMAT } from "./constants.js";

export type { ClosedReason, GridCell, GridResult, VenueSchedule };

export class InvalidOpeningHoursError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOpeningHoursError";
  }
}

export class InvalidGridMinutesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGridMinutesError";
  }
}

export class SlotNotOnGridError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotNotOnGridError";
  }
}

export class SlotOutOfWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotOutOfWindowError";
  }
}

type WeekdayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";

function weekdayKeyOf(businessDate: string, timezone: string): WeekdayKey {
  const luxonWeekday = DateTime.fromISO(businessDate, { zone: timezone }).weekday;
  return String(luxonWeekday % 7) as WeekdayKey;
}

function resolveInstant(local: DateTime, boundary: "earliest" | "latest"): number {
  const candidates = local.getPossibleOffsets();
  const chosen = boundary === "earliest" ? candidates[0] : candidates[candidates.length - 1];
  if (!chosen) {
    throw new Error(`getPossibleOffsets() returned no candidates for ${local.toISO()}`);
  }
  return chosen.toMillis();
}

export function generateSlotGrid(venue: VenueSchedule, businessDate: string): GridResult {
  if (venue.gridMinutes <= 0 || MINUTES_PER_HOUR % venue.gridMinutes !== 0) {
    throw new InvalidGridMinutesError(
      `gridMinutes (${venue.gridMinutes}) must be a positive divisor of 60`,
    );
  }

  const midnightD = DateTime.fromISO(businessDate, { zone: venue.timezone }).startOf("day");
  const midnightD1 = midnightD.plus({ days: 1 });
  const closedWindowStartMs = midnightD.toMillis();
  const closedWindowEndMs = midnightD1.toMillis();

  const weekdayKey = weekdayKeyOf(businessDate, venue.timezone);
  const hours = venue.openingHours[weekdayKey];
  if (hours === null) {
    return {
      kind: "closed",
      reason: CLOSED_REASONS.WEEKDAY_CLOSED,
      windowStartMs: closedWindowStartMs,
      windowEndMs: closedWindowEndMs,
    };
  }
  if (venue.blackoutDates.includes(businessDate)) {
    return {
      kind: "closed",
      reason: CLOSED_REASONS.BLACKOUT,
      windowStartMs: closedWindowStartMs,
      windowEndMs: closedWindowEndMs,
    };
  }

  const openLocal = DateTime.fromISO(`${businessDate}T${hours.open}`, { zone: venue.timezone });
  let closeLocal = DateTime.fromISO(`${businessDate}T${hours.close}`, { zone: venue.timezone });

  if (hours.close <= hours.open) {
    closeLocal = closeLocal.plus({ days: 1 });
  }

  const openInstant = resolveInstant(openLocal, "earliest");
  const closeInstant = resolveInstant(closeLocal, "latest");

  if (closeInstant - openInstant > MS_PER_DAY) {
    throw new InvalidOpeningHoursError(
      `resolved session for ${businessDate} in ${venue.timezone} exceeds 24 hours`,
    );
  }

  const stride = venue.gridMinutes * MS_PER_MINUTE;
  if (closeInstant <= openInstant + stride) {
    return {
      kind: "closed",
      reason: CLOSED_REASONS.NO_VALID_HOURS,
      windowStartMs: closedWindowStartMs,
      windowEndMs: closedWindowEndMs,
    };
  }

  const cells: GridCell[] = [];
  for (let t = openInstant; t + stride <= closeInstant; t += stride) {
    cells.push({
      cellStartMs: t,
      cellEndMs: t + stride,
      localLabel: DateTime.fromMillis(t, { zone: venue.timezone }).toFormat(LOCAL_LABEL_FORMAT),
    });
  }

  return {
    kind: "open",
    cells,
    windowStartMs: openInstant,
    windowEndMs: closeInstant,
  };
}

export function buildClaimCells(
  grid: readonly GridCell[],
  startsAtMs: number,
  slotCount: number,
  bufferSlotCount: number,
): { readonly playMs: readonly number[]; readonly bufferMs: readonly number[] } {
  const startIndex = grid.findIndex((cell) => cell.cellStartMs === startsAtMs);
  if (startIndex === -1) {
    throw new SlotNotOnGridError(`${startsAtMs} does not match any grid cell start`);
  }

  const playEndIndex = startIndex + slotCount;
  if (playEndIndex > grid.length) {
    throw new SlotOutOfWindowError("booking would extend past closing");
  }
  const playMs = grid.slice(startIndex, playEndIndex).map((cell) => cell.cellStartMs);

  const bufferEndIndex = Math.min(playEndIndex + bufferSlotCount, grid.length);
  const bufferMs = grid.slice(playEndIndex, bufferEndIndex).map((cell) => cell.cellStartMs);

  return { playMs, bufferMs };
}