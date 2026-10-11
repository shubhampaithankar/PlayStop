import type { Request, Response } from "express";
import {
  availabilityQuerySchema,
  availabilitySummaryQuerySchema,
  ERROR_CODES,
  freeOwnHeldCells,
  summarizeAvailability,
  type AvailabilityResponse,
  type AvailabilitySummaryResponse,
} from "@playstop/engine";
import { DomainError } from "#errors.js";
import { requireVenue } from "#middleware/venue.js";
import { loadAvailabilitySnapshot } from "#modules/availability/utils.js";

export async function getAvailability(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const parsed = availabilityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 400, "Invalid availability query.", parsed.error.flatten());
  }

  const { result, degraded } = await loadAvailabilitySnapshot(venue, parsed.data);

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

export async function getAvailabilitySummary(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const parsed = availabilitySummaryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 400, "Invalid availability query.", parsed.error.flatten());
  }
  const { date, ownStationId, ownStartsAt, ownSlotCount } = parsed.data;

  const { result, stations, degraded } = await loadAvailabilitySnapshot(venue, { date });

  // The viewer's own hold must not undercount a kind; Mongo stays the truth at confirm time.
  const ownHold =
    ownStationId !== undefined && ownStartsAt !== undefined && ownSlotCount !== undefined
      ? { stationId: ownStationId, startsAt: ownStartsAt, slotCount: ownSlotCount }
      : null;
  const cells = freeOwnHeldCells(result.cells, ownHold);

  const body: AvailabilitySummaryResponse = {
    businessDate: result.businessDate,
    closed: result.closed,
    degraded,
    kinds: summarizeAvailability(stations, cells),
  };
  res.json(body);
}
