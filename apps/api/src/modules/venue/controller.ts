import type { Request, Response } from "express";
import type { VenueResponse } from "@playstop/types";
import { requireVenue } from "#middleware/venue.js";
import { findActiveStations } from "#modules/venue/data.js";

export async function getVenue(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const stations = await findActiveStations(venue._id);

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
