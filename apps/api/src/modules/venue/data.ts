import type { ObjectId } from "mongodb";
import { collections, type StationDoc } from "#libs/mongo/index.js";

export function findActiveStations(venueId: ObjectId): Promise<StationDoc[]> {
  return collections.stations().find({ venueId, status: "active" }).toArray();
}

// Shared by the hold and booking modules: both need the same active,
// venue-scoped station lookup by id before they can price or reserve.
export function findStationById(stationId: ObjectId, venueId: ObjectId): Promise<StationDoc | null> {
  return collections.stations().findOne({ _id: stationId, venueId, status: "active" });
}
