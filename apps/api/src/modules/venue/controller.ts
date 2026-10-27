import type { Request, Response } from "express";
import type { VenueResponse } from "@playstop/engine";
import { requireVenue } from "#middleware/venue.js";

export async function getVenue(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);

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
  };
  res.json(body);
}
