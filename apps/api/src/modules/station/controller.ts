import type { Request, Response } from "express";
import type { StationCatalogResponse } from "@playstop/engine";
import { requireVenue } from "#middleware/venue.js";
import { findActiveStations, toStationSummary } from "#modules/venue/utils.js";

export async function getStations(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const body: StationCatalogResponse = (await findActiveStations(venue._id)).map(toStationSummary);
  res.json(body);
}
