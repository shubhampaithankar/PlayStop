import { DateTime } from "luxon";
import {
  buildClaimCells,
  generateSlotGrid,
  SlotNotOnGridError,
  SlotOutOfWindowError,
  type VenueSchedule,
} from "@playstop/engine";
import type { StationDoc, VenueDoc } from "#db.js";
import { DomainError } from "#errors.js";

export type EngineVenueSchedule = VenueSchedule & { leadTimeMinutes: number; maxAdvanceDays: number };

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

// A legal cell's local calendar date is either the business date it opens
// on, or the following date when the session crosses midnight (section 2).
// Those are the only two possibilities for any cell, since a session is
// capped at 24 hours, so trying both resolves which business date owns it.
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
    "SLOT_NOT_ON_GRID",
    422,
    "That start time is not a legal cell boundary for this venue.",
  );
}

interface ResolvedCells {
  readonly businessDate: string;
  readonly playMs: readonly number[];
  readonly bufferMs: readonly number[];
}

/**
 * Grid + window validation shared by the hold and confirm routes (spec
 * section 4 step 7). bufferSlotCount is 0 for holds: the buffer is a
 * server-side concept the client never sees and never holds.
 */
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
      "SLOT_NOT_ON_GRID",
      422,
      "That start time is not a legal cell boundary for this venue.",
    );
  }

  let cells;
  try {
    cells = buildClaimCells(grid.cells, startsAtMs, slotCount, bufferSlotCount);
  } catch (err) {
    if (err instanceof SlotNotOnGridError) {
      throw new DomainError("SLOT_NOT_ON_GRID", 422, err.message);
    }
    if (err instanceof SlotOutOfWindowError) {
      throw new DomainError("SLOT_OUT_OF_WINDOW", 422, err.message);
    }
    throw err;
  }

  const leadCutoffMs = nowMs + schedule.leadTimeMinutes * 60_000;
  const maxAdvanceCutoffMs = nowMs + schedule.maxAdvanceDays * 86_400_000;
  for (const ms of cells.playMs) {
    if (ms < leadCutoffMs || ms > maxAdvanceCutoffMs) {
      throw new DomainError("SLOT_OUT_OF_WINDOW", 422, "That time is outside the bookable window.");
    }
  }

  const stride = schedule.gridMinutes * 60_000;
  const allStarts = [...cells.playMs, ...cells.bufferMs];
  const inMaintenance = allStarts.some((ms) =>
    station.maintenanceWindows.some((w) => ms < w.endsAt.getTime() && ms + stride > w.startsAt.getTime()),
  );
  if (inMaintenance) {
    throw new DomainError("SLOT_UNAVAILABLE", 409, "That time overlaps a maintenance window.");
  }

  return { businessDate, playMs: cells.playMs, bufferMs: cells.bufferMs };
}

/**
 * Cell reconstruction only, no window/maintenance checks. Used by the
 * release route, which must resolve to "not holding this" rather than an
 * error for a malformed range: release is idempotent by construction.
 */
export function cellStartsForRange(venue: VenueDoc, startsAtMs: number, slotCount: number): readonly number[] {
  const schedule = venueScheduleOf(venue);
  const businessDate = businessDateOf(startsAtMs, schedule);
  const grid = generateSlotGrid(schedule, businessDate);
  if (grid.kind !== "open") {
    throw new DomainError("SLOT_NOT_ON_GRID", 422, "not on grid");
  }
  const { playMs } = buildClaimCells(grid.cells, startsAtMs, slotCount, 0);
  return playMs;
}
