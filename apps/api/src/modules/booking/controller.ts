import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  cancelBookingRequestSchema,
  createBookingRequestSchema,
  getBookingQuerySchema,
  idempotencyKeySchema,
} from "@playstop/types";
import { priceBooking } from "@playstop/engine";
import type { BookingDoc, SlotClaimDoc } from "#libs/mongo/index.js";
import { DomainError } from "#errors.js";
import { requireVenue } from "#middleware/venue.js";
import { findStationById } from "#modules/venue/data.js";
import { resolveRange } from "#modules/venue/utils.js";
import { mgetHolds, releaseHold } from "#modules/hold/data.js";
import { generateConfirmationCode, toBookingPlayer, toBookingResponse } from "#modules/booking/utils.js";
import { abandonClaim, claimIdempotency, finalizeFailure, hashRequest } from "#modules/booking/idempotency.js";
import {
  findBookingByConfirmationCode,
  findBookingById,
  findBookingStation,
  runCancelTransaction,
  runConfirmTransaction,
  type BuiltConfirmDocs,
} from "#modules/booking/data.js";

export async function createBooking(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const requestId = req.locals.requestId;

  const parsed = createBookingRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", 400, "Invalid booking request.", parsed.error.flatten());
  }
  const body = parsed.data;

  const idempotencyKeyHeader = req.header("Idempotency-Key");
  if (idempotencyKeyHeader === undefined) {
    throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key header is required.");
  }
  const keyParsed = idempotencyKeySchema.safeParse(idempotencyKeyHeader);
  if (!keyParsed.success) {
    throw new DomainError("VALIDATION_FAILED", 400, "Malformed Idempotency-Key header.", keyParsed.error.flatten());
  }
  const idempotencyKey = keyParsed.data;

  const now = new Date();
  const requestHash = hashRequest(body);
  const claim = await claimIdempotency(venue._id, idempotencyKey, requestHash, now);
  if (claim.outcome === "replay") {
    res.status(claim.statusCode).setHeader("Idempotent-Replay", "true").json(claim.response);
    return;
  }
  const idemId = claim.id;

  try {
    const station = await findStationById(new ObjectId(body.stationId), venue._id);
    if (!station) {
      throw new DomainError("STATION_NOT_FOUND", 404, "No active station matches that id.");
    }
    const activeStation = station;

    if (body.partySize > station.capacity) {
      throw new DomainError(
        "PARTY_SIZE_EXCEEDS_CAPACITY",
        422,
        `partySize exceeds this station's capacity of ${station.capacity}.`,
      );
    }
    if (body.slotCount < station.minSlots || body.slotCount > station.maxSlots) {
      throw new DomainError(
        "SLOT_COUNT_OUT_OF_RANGE",
        422,
        `slotCount must be between ${station.minSlots} and ${station.maxSlots} for this station.`,
      );
    }

    const startsAtMs = new Date(body.startsAt).getTime();
    const nowMs = now.getTime();
    const bufferSlotCount = venue.bufferMinutes > 0 ? Math.ceil(venue.bufferMinutes / venue.gridMinutes) : 0;
    const { playMs, bufferMs } = resolveRange(venue, activeStation, startsAtMs, body.slotCount, bufferSlotCount, nowMs);

    // Hold verification decision table (spec section 4 step 8). Only play
    // cells are verified; buffer cells were never held.
    if (body.holdId !== undefined) {
      const { values, degraded } = await mgetHolds(venue._id, activeStation._id, playMs);
      if (!degraded) {
        if (values.some((v) => v !== null && v !== body.holdId)) {
          throw new DomainError("SLOT_HELD", 409, "Someone else holds part of that time.");
        }
        if (values.some((v) => v === null)) {
          throw new DomainError("HOLD_EXPIRED", 410, "That hold has expired.");
        }
      }
      // degraded: proceed. Redis being down must never block a booking.
    }

    const stride = venue.gridMinutes * 60_000;
    const endsAtMs = startsAtMs + body.slotCount * stride;
    const totalMinor = priceBooking(activeStation, venue.gridMinutes, body.slotCount);

    // Build first, write second: withTransaction may run its callback more
    // than once, so every document is built before the transaction starts.
    function buildDocs(): BuiltConfirmDocs {
      const bookingId = new ObjectId();
      const confirmationCode = generateConfirmationCode();
      const bookingDoc: BookingDoc = {
        _id: bookingId,
        venueId: venue._id,
        stationId: activeStation._id,
        startsAt: new Date(startsAtMs),
        endsAt: new Date(endsAtMs),
        slotCount: body.slotCount,
        bufferSlotCount,
        partySize: body.partySize,
        status: "confirmed",
        confirmationCode,
        totalMinor,
        currency: venue.currency,
        player: toBookingPlayer(body.player),
        idempotencyKey,
        createdAt: now,
        cancelledAt: null,
      };
      const claimDocs: SlotClaimDoc[] = [
        ...playMs.map((ms) => ({
          _id: new ObjectId(),
          venueId: venue._id,
          stationId: activeStation._id,
          bookingId,
          cellStart: new Date(ms),
          kind: "play" as const,
          status: "confirmed" as const,
          createdAt: now,
        })),
        ...bufferMs.map((ms) => ({
          _id: new ObjectId(),
          venueId: venue._id,
          stationId: activeStation._id,
          bookingId,
          cellStart: new Date(ms),
          kind: "buffer" as const,
          status: "confirmed" as const,
          createdAt: now,
        })),
      ];
      const responseBody = toBookingResponse(bookingDoc, activeStation.name, activeStation.kind, venue.timezone);
      return { bookingDoc, claimDocs, responseBody };
    }

    const { responseBody } = await runConfirmTransaction(idemId, buildDocs);

    // Fire-and-forget: errors ignored, the TTL is the backstop.
    if (body.holdId !== undefined) {
      releaseHold(venue._id, activeStation._id, playMs, body.holdId).catch(() => {});
    }

    res.status(201).json(responseBody);
  } catch (err) {
    // Deterministic domain failure (404/409/410/422): replayable, record
    // stays. Non-deterministic infra failure (503/500, or anything not a
    // DomainError): delete, so the client can retry the same key.
    if (err instanceof DomainError && err.status !== 503 && err.status !== 500) {
      await finalizeFailure(idemId, err.status, {
        error: { code: err.code, message: err.message, details: err.details, requestId },
      });
    } else {
      await abandonClaim(idemId);
    }
    throw err;
  }
}

export async function getBooking(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const parsed = getBookingQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", 400, "Missing or malformed code.", parsed.error.flatten());
  }
  const bookingIdParam = req.params.bookingId;
  if (typeof bookingIdParam !== "string" || !ObjectId.isValid(bookingIdParam)) {
    throw new DomainError("BOOKING_NOT_FOUND", 404, "No booking matches that id.");
  }
  const booking = await findBookingByConfirmationCode(new ObjectId(bookingIdParam), venue._id, parsed.data.code);
  if (!booking) throw new DomainError("BOOKING_NOT_FOUND", 404, "No booking matches that id.");

  const station = await findBookingStation(booking.stationId);
  if (!station) throw new Error("station referenced by booking not found");
  res.json(toBookingResponse(booking, station.name, station.kind, venue.timezone));
}

export async function cancelBooking(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const bookingIdParam = req.params.bookingId;
  const parsed = cancelBookingRequestSchema.safeParse(req.body);
  if (typeof bookingIdParam !== "string" || !ObjectId.isValid(bookingIdParam) || !parsed.success) {
    throw new DomainError(
      "VALIDATION_FAILED",
      400,
      "Invalid cancel request.",
      parsed.success ? undefined : parsed.error.flatten(),
    );
  }
  const bookingId = new ObjectId(bookingIdParam);
  const { confirmationCode } = parsed.data;

  const booking = await findBookingByConfirmationCode(bookingId, venue._id, confirmationCode);
  if (!booking) throw new DomainError("BOOKING_NOT_FOUND", 404, "No booking matches that id.");

  const station = await findBookingStation(booking.stationId);
  if (!station) throw new Error("station referenced by booking not found");

  // Idempotent: already cancelled returns 200 with the record as-is.
  if (booking.status === "cancelled") {
    res.status(200).json(toBookingResponse(booking, station.name, station.kind, venue.timezone));
    return;
  }

  const nowMs = Date.now();
  if (nowMs >= booking.startsAt.getTime()) {
    throw new DomainError("BOOKING_NOT_CANCELLABLE", 422, "This booking has already started or finished.");
  }

  const cancelledAt = new Date();
  const { lostRace } = await runCancelTransaction(bookingId, venue._id, booking.stationId, cancelledAt);

  const finalBooking = lostRace
    ? await findBookingById(bookingId, venue._id)
    : { ...booking, status: "cancelled" as const, cancelledAt };
  if (!finalBooking) throw new Error("booking vanished after a concurrent cancel");
  res.status(200).json(toBookingResponse(finalBooking, station.name, station.kind, venue.timezone));
}
