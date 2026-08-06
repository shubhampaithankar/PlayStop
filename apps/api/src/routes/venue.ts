import { DateTime } from "luxon";
import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { availabilityQuerySchema, type AvailabilityResponse, type VenueResponse } from "@playstop/types";
import {
  computeAvailability,
  generateSlotGrid,
  type OccupiedCell,
  type StationInput as EngineStationInput,
} from "@playstop/engine";
import { collections, type VenueDoc } from "#db.js";
import { DomainError } from "#errors.js";
import { scanVenueHolds } from "#holds.js";
import { venueScheduleOf } from "#lib/gridLookup.js";

function requireVenue(req: Request): VenueDoc {
  if (!req.venue) throw new DomainError("VENUE_NOT_FOUND", 404, "No venue matches that slug.");
  return req.venue;
}

export async function getVenue(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const stations = await collections.stations().find({ venueId: venue._id, status: "active" }).toArray();

  const body: VenueResponse = {
    id: venue._id.toHexString(),
    slug: venue.slug,
    name: venue.name,
    timezone: venue.timezone,
    gridMinutes: venue.gridMinutes,
    bufferMinutes: venue.bufferMinutes,
    currency: venue.currency,
    openingHours: venue.openingHours,
    blackoutDates: venue.blackoutDates,
    leadTimeMinutes: venue.leadTimeMinutes,
    maxAdvanceDays: venue.maxAdvanceDays,
    stations: stations.map((s) => ({
      id: s._id.toHexString(),
      slug: s.slug,
      name: s.name,
      kind: s.kind,
      capacity: s.capacity,
      hourlyRateMinor: s.hourlyRateMinor,
      minSlots: s.minSlots,
      maxSlots: s.maxSlots,
    })),
  };
  res.json(body);
}

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

  const stationFilter: Record<string, unknown> = { venueId: venue._id, status: "active" };
  if (stationId) stationFilter._id = new ObjectId(stationId);
  if (kind) stationFilter.kind = kind;
  const stationDocs = await collections.stations().find(stationFilter).toArray();
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
    const claimDocs = await collections
      .slotClaims()
      .find(
        {
          venueId: venue._id,
          cellStart: { $gte: new Date(grid.windowStartMs), $lt: new Date(grid.windowEndMs) },
          status: "confirmed",
        },
        { projection: { stationId: 1, cellStart: 1, _id: 0 } },
      )
      .toArray();
    claims = claimDocs.map((c) => ({ stationId: c.stationId.toHexString(), cellStartMs: c.cellStart.getTime() }));

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
