import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  createHoldRequestSchema,
  priceBooking,
  releaseHoldRequestSchema,
  type CreateHoldResponse,
} from "@playstop/engine";
import { env } from "#env.js";
import { DomainError } from "#errors.js";
import { requireVenue } from "#middleware/venue.js";
import { findStationById } from "#modules/venue/data.js";
import { cellStartsForRange, resolveRange } from "#modules/venue/utils.js";
import { acquireHold, findConfirmedClaimInRange, releaseHold } from "#modules/hold/data.js";

export async function createHold(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const parsed = createHoldRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", 400, "Invalid hold request.", parsed.error.flatten());
  }
  const { stationId, startsAt, slotCount } = parsed.data;

  const station = await findStationById(new ObjectId(stationId), venue._id);
  if (!station) throw new DomainError("STATION_NOT_FOUND", 404, "No active station matches that id.");

  if (slotCount < station.minSlots || slotCount > station.maxSlots) {
    throw new DomainError(
      "SLOT_COUNT_OUT_OF_RANGE",
      422,
      `slotCount must be between ${station.minSlots} and ${station.maxSlots} for this station.`,
    );
  }

  const startsAtMs = new Date(startsAt).getTime();
  const nowMs = Date.now();
  // A hold never covers a buffer: it is a server-side concept the client
  // never sees and never holds.
  const { playMs } = resolveRange(venue, station, startsAtMs, slotCount, 0, nowMs);

  const existingClaim = await findConfirmedClaimInRange(venue._id, station._id, playMs);
  if (existingClaim) {
    throw new DomainError("SLOT_TAKEN", 409, "Part of that time is already booked.");
  }

  const holdId = randomUUID();
  const ttlMs = env.HOLD_TTL_SECONDS * 1000;
  const { acquired, degraded } = await acquireHold(venue._id, station._id, playMs, holdId, ttlMs);
  if (degraded) {
    throw new DomainError(
      "HOLD_UNAVAILABLE",
      503,
      "Holds are temporarily unavailable. Confirm without a holdId instead.",
    );
  }
  if (!acquired) {
    throw new DomainError("SLOT_HELD", 409, "Part of that time is already held by someone else.");
  }

  const lastPlayMs = playMs[playMs.length - 1] ?? startsAtMs;
  const endsAtMs = lastPlayMs + venue.gridMinutes * 60_000;
  const expiresAt = new Date(nowMs + ttlMs);
  const quoteMinor = priceBooking(station, venue.gridMinutes, slotCount);

  const body: CreateHoldResponse = {
    holdId,
    stationId: station._id.toHexString(),
    startsAt,
    endsAt: new Date(endsAtMs).toISOString(),
    slotCount,
    expiresAt: expiresAt.toISOString(),
    ttlSeconds: env.HOLD_TTL_SECONDS,
    quoteMinor,
    currency: venue.currency,
  };
  res.status(201).json(body);
}

export async function releaseHoldRoute(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const parsed = releaseHoldRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", 400, "Invalid release request.", parsed.error.flatten());
  }
  const { holdId, stationId, startsAt, slotCount } = parsed.data;
  const startsAtMs = new Date(startsAt).getTime();

  // Release needs only the venue's grid, not the station document: cell
  // timing doesn't depend on station attributes, only stationId for the key.
  let playMs: readonly number[];
  try {
    playMs = cellStartsForRange(venue, startsAtMs, slotCount);
  } catch {
    // A range that was never a legal cell boundary was never a legal hold
    // either. Release is idempotent by construction: "not holding this" is
    // true either way, so this is a no-op 204, not an error.
    res.status(204).end();
    return;
  }

  await releaseHold(venue._id, new ObjectId(stationId), playMs, holdId);
  res.status(204).end();
}
