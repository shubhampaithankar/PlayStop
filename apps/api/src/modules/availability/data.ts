import { ObjectId, type Filter } from "mongodb";
import type { OccupiedCell } from "@playstop/engine";
import type { AvailabilityQuery } from "@playstop/engine";
import { collections, type StationDoc } from "#libs/mongo/index.js";

export function findStationsForAvailability(
  venueId: ObjectId,
  stationId: AvailabilityQuery["stationId"],
  kind: AvailabilityQuery["kind"],
): Promise<StationDoc[]> {
  const stationFilter: Filter<StationDoc> = { venueId, status: "active" };
  if (stationId) stationFilter._id = new ObjectId(stationId);
  if (kind) stationFilter.kind = kind;
  return collections.stations().find(stationFilter).toArray();
}

export async function findConfirmedClaims(
  venueId: ObjectId,
  windowStartMs: number,
  windowEndMs: number,
): Promise<OccupiedCell[]> {
  const claimDocs = await collections
    .slotClaims()
    .find(
      {
        venueId,
        cellStart: { $gte: new Date(windowStartMs), $lt: new Date(windowEndMs) },
        status: "confirmed",
      },
      { projection: { stationId: 1, cellStart: 1, _id: 0 } },
    )
    .toArray();
  return claimDocs.map((c) => ({ stationId: c.stationId.toHexString(), cellStartMs: c.cellStart.getTime() }));
}
