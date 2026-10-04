import { DateTime } from "luxon";
import type { ObjectId } from "mongodb";
import {
  buildClaimCells,
  ERROR_CODES,
  generateSlotGrid,
  SlotNotOnGridError,
  SlotOutOfWindowError,
  type VenueSchedule,
} from "@playstop/engine";
import { collections, type StationDoc, type VenueDoc } from "#libs/mongo/index.js";
import { DomainError } from "#errors.js";
import type { EngineVenueSchedule, ResolvedCells } from "#types/venue.js";

export function venueScheduleOf(venue: VenueDoc): EngineVenueSchedule {
  return {
    timezone: venue.timezone,
    gridMinutes: venue.gridMinutes,
    bufferMinutes: venue.bufferMinutes,
    openingHours: venue.openingHours,
    blackoutDates: venue.blackoutDates,
    leadTimeMinutes: venue.leadTimeMinutes,
    maxAdvanceDays: venue.maxAdvanceDays,
  };
}

export function localLabelOf(cellStartMs: number, timezone: string): string {
  return DateTime.fromMillis(cellStartMs, { zone: timezone }).toFormat("yyyy-MM-dd HH:mm ZZZZ");
}

function businessDateOf(startsAtMs: number, schedule: VenueSchedule): string {
  const local = DateTime.fromMillis(startsAtMs, { zone: schedule.timezone });
  const candidates = [local.toISODate(), local.minus({ days: 1 }).toISODate()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    let grid;
    try {
      grid = generateSlotGrid(schedule, candidate);
    } catch {
      continue;
    }
    if (grid.kind === "open" && grid.cells.some((cell) => cell.cellStartMs === startsAtMs)) {
      return candidate;
    }
  }
  throw new DomainError(
    ERROR_CODES.SLOT_NOT_ON_GRID,
    422,
    "That start time is not a legal cell boundary for this venue.",
  );
}

export function resolveRange(
  venue: VenueDoc,
  station: Pick<StationDoc, "maintenanceWindows">,
  startsAtMs: number,
  slotCount: number,
  bufferSlotCount: number,
  nowMs: number,
): ResolvedCells {
  const schedule = venueScheduleOf(venue);
  const businessDate = businessDateOf(startsAtMs, schedule);
  const grid = generateSlotGrid(schedule, businessDate);
  if (grid.kind !== "open") {
    throw new DomainError(
      ERROR_CODES.SLOT_NOT_ON_GRID,
      422,
      "That start time is not a legal cell boundary for this venue.",
    );
  }

  let cells;
  try {
    cells = buildClaimCells(grid.cells, startsAtMs, slotCount, bufferSlotCount);
  } catch (err) {
    if (err instanceof SlotNotOnGridError) {
      throw new DomainError(ERROR_CODES.SLOT_NOT_ON_GRID, 422, err.message);
    }
    if (err instanceof SlotOutOfWindowError) {
      throw new DomainError(ERROR_CODES.SLOT_OUT_OF_WINDOW, 422, err.message);
    }
    throw err;
  }

  const leadCutoffMs = nowMs + schedule.leadTimeMinutes * 60_000;
  for (const ms of cells.playMs) {
    if (ms < leadCutoffMs) {
      throw new DomainError(ERROR_CODES.SLOT_TOO_SOON, 422, "That time is too soon to book.");
    }
  }

  const localToday = DateTime.fromMillis(nowMs, { zone: schedule.timezone }).startOf("day");
  const cellLocalDate = DateTime.fromISO(businessDate, { zone: schedule.timezone }).startOf("day");
  const daysFromToday = cellLocalDate.diff(localToday, "days").days;
  if (daysFromToday < -1 || daysFromToday > schedule.maxAdvanceDays) {
    throw new DomainError(ERROR_CODES.DATE_OUT_OF_RANGE, 422, "That date is outside the bookable range.");
  }

  const stride = schedule.gridMinutes * 60_000;
  const allStarts = [...cells.playMs, ...cells.bufferMs];
  const inMaintenance = allStarts.some((ms) =>
    station.maintenanceWindows.some((w) => ms < w.endsAt.getTime() && ms + stride > w.startsAt.getTime()),
  );
  if (inMaintenance) {
    throw new DomainError(ERROR_CODES.SLOT_UNAVAILABLE, 409, "That time overlaps a maintenance window.");
  }

  return { businessDate, playMs: cells.playMs, bufferMs: cells.bufferMs };
}

export function cellStartsForRange(venue: VenueDoc, startsAtMs: number, slotCount: number): readonly number[] {
  const schedule = venueScheduleOf(venue);
  const businessDate = businessDateOf(startsAtMs, schedule);
  const grid = generateSlotGrid(schedule, businessDate);
  if (grid.kind !== "open") {
    throw new DomainError(ERROR_CODES.SLOT_NOT_ON_GRID, 422, "not on grid");
  }
  const { playMs } = buildClaimCells(grid.cells, startsAtMs, slotCount, 0);
  return playMs;
}

export function findActiveStations(venueId: ObjectId): Promise<StationDoc[]> {
  return collections.stations().find({ venueId, status: "active" }).toArray();
}

export function findStationById(stationId: ObjectId, venueId: ObjectId): Promise<StationDoc | null> {
  return collections.stations().findOne({ _id: stationId, venueId, status: "active" });
}
