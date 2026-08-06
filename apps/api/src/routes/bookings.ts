import type { Request, Response } from "express";
import { MongoOperationTimeoutError, MongoServerError, ObjectId } from "mongodb";
import {
  cancelBookingRequestSchema,
  type CreateBookingRequest,
  createBookingRequestSchema,
  getBookingQuerySchema,
  idempotencyKeySchema,
  type BookingResponse,
} from "@playstop/types";
import { priceBooking } from "@playstop/engine";
import { collections, mongoClient, type BookingDoc, type SlotClaimDoc, type VenueDoc } from "#db.js";
import { DomainError } from "#errors.js";
import { releaseHold, mgetHolds } from "#holds.js";
import { generateConfirmationCode } from "#lib/confirmationCode.js";
import { localLabelOf, resolveRange } from "#lib/gridLookup.js";
import { abandonClaim, claimIdempotency, finalizeFailure, hashRequest } from "#lib/idempotency.js";

function requireVenue(req: Request): VenueDoc {
  if (!req.venue) throw new DomainError("VENUE_NOT_FOUND", 404, "No venue matches that slug.");
  return req.venue;
}

function toBookingResponse(
  booking: Pick<
    BookingDoc,
    | "_id"
    | "venueId"
    | "stationId"
    | "startsAt"
    | "endsAt"
    | "slotCount"
    | "partySize"
    | "status"
    | "confirmationCode"
    | "totalMinor"
    | "currency"
    | "player"
    | "createdAt"
    | "cancelledAt"
  >,
  stationName: string,
  stationKind: BookingResponse["stationKind"],
  timezone: string,
): BookingResponse {
  return {
    id: booking._id.toHexString(),
    venueId: booking.venueId.toHexString(),
    stationId: booking.stationId.toHexString(),
    stationName,
    stationKind,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    slotCount: booking.slotCount,
    partySize: booking.partySize,
    localLabel: localLabelOf(booking.startsAt.getTime(), timezone),
    status: booking.status,
    confirmationCode: booking.confirmationCode,
    totalMinor: booking.totalMinor,
    currency: booking.currency,
    player: booking.player,
    createdAt: booking.createdAt.toISOString(),
    cancelledAt: booking.cancelledAt ? booking.cancelledAt.toISOString() : null,
  };
}

// Zod's .optional() infers `T | undefined`, which exactOptionalPropertyTypes
// rejects when assigned directly onto BookingPlayer's `email?: string`
// (present-with-undefined is a different thing than absent). Build the
// document field by omission instead of ever storing an explicit undefined.
function toBookingPlayer(player: CreateBookingRequest["player"]): BookingDoc["player"] {
  const result: BookingDoc["player"] = { name: player.name };
  if (player.email !== undefined) result.email = player.email;
  if (player.phone !== undefined) result.phone = player.phone;
  return result;
}
interface BuiltConfirmDocs {
  readonly bookingDoc: BookingDoc;
  readonly claimDocs: SlotClaimDoc[];
  readonly responseBody: BookingResponse;
}

/**
 * The transaction, exactly per spec section 4 step 10, plus the 11000 catch
 * disambiguated by index name and the confirmation-code collision retry.
 * buildDocs is called once per attempt, generating a fresh bookingId and
 * confirmationCode: the driver's own internal transient-error retries reuse
 * the same built documents (transaction hygiene), but a genuine code
 * collision is a different attempt with different documents by design.
 */
async function runConfirmTransaction(
  idemId: string,
  buildDocs: () => BuiltConfirmDocs,
  attempt = 1,
): Promise<{ responseBody: BookingResponse }> {
  const { bookingDoc, claimDocs, responseBody } = buildDocs();
  const session = mongoClient().startSession();
  try {
    await session.withTransaction(
      async () => {
        await collections.bookings().insertOne(bookingDoc, { session });
        await collections.slotClaims().insertMany(claimDocs, { session, ordered: true });
        await collections.idempotency().updateOne(
          { _id: idemId },
          { $set: { state: "completed", statusCode: 201, response: responseBody, bookingId: bookingDoc._id } },
          { session },
        );
      },
      { readConcern: { level: "local" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 8000 },
    );
    return { responseBody };
  } catch (err) {
    if (
      attempt === 1 &&
      err instanceof MongoServerError &&
      err.code === 11000 &&
      err.message.includes("uniq_booking_code")
    ) {
      return runConfirmTransaction(idemId, buildDocs, 2);
    }
    if (err instanceof MongoOperationTimeoutError) {
      throw new DomainError("BOOKING_TIMEOUT", 503, "Could not confirm in time. Try again.", undefined, {
        "Retry-After": "2",
      });
    }
    if (err instanceof MongoServerError && err.code === 11000) {
      if (err.message.includes("uniq_slot_claim")) {
        throw new DomainError("SLOT_TAKEN", 409, "Part of that time was just booked by someone else.");
      }
      if (err.message.includes("uniq_booking_code")) {
        throw new DomainError("INTERNAL", 500, "Could not generate a unique confirmation code.");
      }
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

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
    const station = await collections
      .stations()
      .findOne({ _id: new ObjectId(body.stationId), venueId: venue._id, status: "active" });
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
  const booking = await collections.bookings().findOne({
    _id: new ObjectId(bookingIdParam),
    venueId: venue._id,
    confirmationCode: parsed.data.code,
  });
  if (!booking) throw new DomainError("BOOKING_NOT_FOUND", 404, "No booking matches that id.");

  const station = await collections.stations().findOne({ _id: booking.stationId });
  if (!station) throw new Error("station referenced by booking not found");
  res.json(toBookingResponse(booking, station.name, station.kind, venue.timezone));
}

class ConcurrentCancelError extends Error {}

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

  const booking = await collections.bookings().findOne({ _id: bookingId, venueId: venue._id, confirmationCode });
  if (!booking) throw new DomainError("BOOKING_NOT_FOUND", 404, "No booking matches that id.");

  const station = await collections.stations().findOne({ _id: booking.stationId });
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
  let lostRace = false;
  const session = mongoClient().startSession();
  try {
    await session.withTransaction(
      async () => {
        const updateResult = await collections.bookings().updateOne(
          { _id: bookingId, venueId: venue._id, status: "confirmed" },
          { $set: { status: "cancelled", cancelledAt } },
          { session },
        );
        // A concurrent cancel won the race on this document: Mongo
        // serializes the two updateOne calls, so exactly one matches.
        if (updateResult.matchedCount === 0) throw new ConcurrentCancelError();
        await collections.slotClaims().updateMany(
          { venueId: venue._id, stationId: booking.stationId, bookingId, status: "confirmed" },
          { $set: { status: "cancelled" } },
          { session },
        );
      },
      { readConcern: { level: "local" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 8000 },
    );
  } catch (err) {
    if (err instanceof ConcurrentCancelError) {
      lostRace = true;
    } else if (err instanceof MongoOperationTimeoutError) {
      throw new DomainError("BOOKING_TIMEOUT", 503, "Could not cancel in time. Try again.", undefined, {
        "Retry-After": "2",
      });
    } else {
      throw err;
    }
  } finally {
    await session.endSession();
  }

  const finalBooking = lostRace
    ? await collections.bookings().findOne({ _id: bookingId, venueId: venue._id })
    : { ...booking, status: "cancelled" as const, cancelledAt };
  if (!finalBooking) throw new Error("booking vanished after a concurrent cancel");
  res.status(200).json(toBookingResponse(finalBooking, station.name, station.kind, venue.timezone));
}
