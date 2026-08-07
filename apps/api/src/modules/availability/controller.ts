import { DateTime } from "luxon";
import type { Request, Response } from "express";
import { availabilityQuerySchema, type AvailabilityResponse } from "@playstop/types";
import {
  computeAvailability,
  generateSlotGrid,
  type OccupiedCell,
  type StationInput as EngineStationInput,
} from "@playstop/engine";
import { DomainError } from "#errors.js";
import { requireVenue } from "#middleware/venue.js";
import { scanVenueHolds } from "#modules/hold/data.js";
import { venueScheduleOf } from "#modules/venue/utils.js";
import { findConfirmedClaims, findStationsForAvailability } from "#modules/availability/data.js";

export async function getAvailability(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const parsed = availabilityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", 400, "Invalid availability query.", parsed.error.flatten());
  }
  const { date, stationId, kind } = parsed.data;
  const schedule = venueScheduleOf(venue);

  // Coarse gate on the whole business date; computeAvailability separately
  // marks individual cells past/too_far_ahead at cell precision.
  const localToday = DateTime.now().setZone(venue.timezone).startOf("day");
  const requestedDate = DateTime.fromISO(date, { zone: venue.timezone }).startOf("day");
  const daysFromToday = requestedDate.diff(localToday, "days").days;
  if (daysFromToday < -1 || daysFromToday > venue.maxAdvanceDays) {
    throw new DomainError("DATE_OUT_OF_RANGE", 422, "That date is outside the bookable range.");
  }

  const stationDocs = await findStationsForAvailability(venue._id, stationId, kind);
  const stations: EngineStationInput[] = stationDocs.map((s) => ({
    stationId: s._id.toHexString(),
    slug: s.slug,
    name: s.name,
    kind: s.kind,
    capacity: s.capacity,
    hourlyRateMinor: s.hourlyRateMinor,
    minSlots: s.minSlots,
    maxSlots: s.maxSlots,
    maintenanceWindows: s.maintenanceWindows.map((w) => ({
      startsAtMs: w.startsAt.getTime(),
      endsAtMs: w.endsAt.getTime(),
    })),
  }));

  const grid = generateSlotGrid(schedule, date);

  let claims: OccupiedCell[] = [];
  let holdCells: OccupiedCell[] = [];
  let degraded = false;

  // Closed venue: no cells exist, so the Mongo and Redis reads are skipped
  // entirely (spec section 2); windowStartMs/windowEndMs are informational.
  if (grid.kind === "open") {
    claims = await findConfirmedClaims(venue._id, grid.windowStartMs, grid.windowEndMs);

    const scan = await scanVenueHolds(venue._id);
    degraded = scan.degraded;
    holdCells = scan.holds
      .filter((h) => h.cellStartMs >= grid.windowStartMs && h.cellStartMs < grid.windowEndMs)
      .map((h) => ({ stationId: h.stationId, cellStartMs: h.cellStartMs }));
  }

  const result = computeAvailability({
    venue: schedule,
    businessDate: date,
    stations,
    claims,
    holds: holdCells,
    nowMs: Date.now(),
  });

  const body: AvailabilityResponse = {
    businessDate: result.businessDate,
    timezone: result.timezone,
    gridMinutes: result.gridMinutes,
    closed: result.closed,
    degraded,
    cells: [...result.cells],
  };
  res.json(body);
}
