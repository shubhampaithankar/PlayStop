import { DateTime } from "luxon";
import { ObjectId, type Filter } from "mongodb";
import {
  computeAvailability,
  ERROR_CODES,
  generateSlotGrid,
  type AvailabilityQuery,
  type OccupiedCell,
  type StationInput as EngineStationInput,
} from "@playstop/engine";
import { DomainError } from "#errors.js";
import { collections, type StationDoc, type VenueDoc } from "#libs/mongo/index.js";
import { scanVenueHolds } from "#modules/hold/utils.js";
import { toStationSummary, venueScheduleOf } from "#modules/venue/utils.js";
import type { AvailabilitySnapshot } from "#types/availability.js";

export function findStationsForAvailability(
  venueId: ObjectId,
  stationId: AvailabilityQuery["stationId"],
  kind: StationDoc["kind"] | undefined,
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

export async function loadAvailabilitySnapshot(
  venue: VenueDoc,
  query: Pick<AvailabilityQuery, "date" | "stationId"> & { kind?: StationDoc["kind"] },
): Promise<AvailabilitySnapshot> {
  const { date, stationId, kind } = query;
  const schedule = venueScheduleOf(venue);

  const localToday = DateTime.now().setZone(venue.timezone).startOf("day");
  const requestedDate = DateTime.fromISO(date, { zone: venue.timezone }).startOf("day");
  const daysFromToday = requestedDate.diff(localToday, "days").days;
  if (daysFromToday < -1 || daysFromToday > venue.maxAdvanceDays) {
    throw new DomainError(ERROR_CODES.DATE_OUT_OF_RANGE, 422, "That date is outside the bookable range.");
  }

  const stationDocs = await findStationsForAvailability(venue._id, stationId, kind);
  const engineStations: EngineStationInput[] = stationDocs.map((s) => {
    const { id, ...summary } = toStationSummary(s);
    return {
      stationId: id,
      ...summary,
      maintenanceWindows: s.maintenanceWindows.map((w) => ({
        startsAtMs: w.startsAt.getTime(),
        endsAtMs: w.endsAt.getTime(),
      })),
    };
  });
  const stations = stationDocs.map(toStationSummary);

  const grid = generateSlotGrid(schedule, date);

  let claims: OccupiedCell[] = [];
  let holdCells: OccupiedCell[] = [];
  let degraded = false;

  if (grid.kind === "open") {
    const [confirmedClaims, scan] = await Promise.all([
      findConfirmedClaims(venue._id, grid.windowStartMs, grid.windowEndMs),
      scanVenueHolds(venue._id),
    ]);
    claims = confirmedClaims;
    degraded = scan.degraded;
    holdCells = scan.holds
      .filter((h) => h.cellStartMs >= grid.windowStartMs && h.cellStartMs < grid.windowEndMs)
      .map((h) => ({ stationId: h.stationId, cellStartMs: h.cellStartMs }));
  }

  const result = computeAvailability({
    venue: schedule,
    businessDate: date,
    stations: engineStations,
    claims,
    holds: holdCells,
    nowMs: Date.now(),
  });

  return { result, stations, degraded };
}
