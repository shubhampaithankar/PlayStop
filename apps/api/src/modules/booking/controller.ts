import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  cancelBookingRequestSchema,
  createBookingRequestSchema,
  ERROR_CODES,
  getBookingQuerySchema,
  idempotencyKeySchema,
  lookupBookingsRequestSchema,
  priceBooking,
} from "@playstop/engine";
import type { BookingDoc, SlotClaimDoc } from "#libs/mongo/index.js";
import { DomainError } from "#errors.js";
import { requireVenue } from "#middleware/venue.js";
import { findStationById, resolveRange } from "#modules/venue/utils.js";
import { mgetHolds, releaseHold } from "#modules/hold/utils.js";
import { deleteOtpChallenge, getOtpVerification } from "#modules/otp/utils.js";
import {
  abandonClaim,
  claimIdempotency,
  finalizeFailure,
  findBookingByConfirmationCode,
  findBookingById,
  findBookingStation,
  findBookingsByContact,
  findStationsByIds,
  generateConfirmationCode,
  hashRequest,
  notifyCancellation,
  notifyConfirmation,
  runCancelTransaction,
  runConfirmTransaction,
  toBookingPlayer,
  toBookingResponse,
} from "#modules/booking/utils.js";
import type { BuiltConfirmDocs } from "#types/booking.js";

export async function createBooking(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const requestId = req.locals.requestId;

  const parsed = createBookingRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 400, "Invalid booking request.", parsed.error.flatten());
  }
  const body = parsed.data;

  const idempotencyKeyHeader = req.header("Idempotency-Key");
  if (idempotencyKeyHeader === undefined) {
    throw new DomainError(ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED, 400, "Idempotency-Key header is required.");
  }
  const keyParsed = idempotencyKeySchema.safeParse(idempotencyKeyHeader);
  if (!keyParsed.success) {
    throw new DomainError(
      ERROR_CODES.VALIDATION_FAILED,
      400,
      "Malformed Idempotency-Key header.",
      keyParsed.error.flatten(),
    );
  }
  const idempotencyKey = keyParsed.data;

  const now = new Date();
  const { holdId: _idemHoldId, verificationId: _idemVerificationId, ...idempotencyIdentity } = body;
  const requestHash = hashRequest(idempotencyIdentity);
  const claim = await claimIdempotency(venue._id, idempotencyKey, requestHash, now);
  if (claim.outcome === "replay") {
    res.status(claim.statusCode).setHeader("Idempotent-Replay", "true").json(claim.response);
    return;
  }
  const idemId = claim.id;

  try {
    const station = await findStationById(new ObjectId(body.stationId), venue._id);
    if (!station) {
      throw new DomainError(ERROR_CODES.STATION_NOT_FOUND, 404, "No active station matches that id.");
    }
    const activeStation = station;

    if (body.partySize > station.capacity) {
      throw new DomainError(
        ERROR_CODES.PARTY_SIZE_EXCEEDS_CAPACITY,
        422,
        `partySize exceeds this station's capacity of ${station.capacity}.`,
      );
    }
    if (body.slotCount < station.minSlots || body.slotCount > station.maxSlots) {
      throw new DomainError(
        ERROR_CODES.SLOT_COUNT_OUT_OF_RANGE,
        422,
        `slotCount must be between ${station.minSlots} and ${station.maxSlots} for this station.`,
      );
    }

    const startsAtMs = new Date(body.startsAt).getTime();
    const nowMs = now.getTime();
    const bufferSlotCount = venue.bufferMinutes > 0 ? Math.ceil(venue.bufferMinutes / venue.gridMinutes) : 0;
    const { playMs, bufferMs } = resolveRange(venue, activeStation, startsAtMs, body.slotCount, bufferSlotCount, nowMs);

    if (body.holdId !== undefined) {
      const { values, degraded } = await mgetHolds(venue._id, activeStation._id, playMs);
      if (!degraded) {
        if (values.some((v) => v !== null && v !== body.holdId)) {
          throw new DomainError(ERROR_CODES.SLOT_HELD, 409, "Someone else holds part of that time.");
        }
        if (values.some((v) => v === null)) {
          throw new DomainError(ERROR_CODES.HOLD_EXPIRED, 410, "That hold has expired.");
        }
      }
    }

    const { value: verification, degraded: otpDegraded } = await getOtpVerification(venue._id, body.verificationId);
    if (otpDegraded) {
      throw new DomainError(ERROR_CODES.OTP_REQUIRED, 403, "OTP verification is temporarily unavailable.");
    }
    if (verification === null) {
      throw new DomainError(ERROR_CODES.OTP_EXPIRED, 410, "That verification has expired or was already used.");
    }
    if (!verification.verified) {
      throw new DomainError(ERROR_CODES.OTP_REQUIRED, 403, "Verification is required before confirming.");
    }
    const contactChannel = verification.channel;
    const contact = verification.contact;

    const stride = venue.gridMinutes * 60_000;
    const endsAtMs = startsAtMs + body.slotCount * stride;
    const totalMinor = priceBooking(activeStation, venue.gridMinutes, body.slotCount);

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
        contactChannel,
        contact,
        idempotencyKey,
        createdAt: now,
        cancelledAt: null,
        confirmationSentAt: null,
        cancellationSentAt: null,
        nudgeSentAt: null,
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

    if (body.holdId !== undefined) {
      releaseHold(venue._id, activeStation._id, playMs, body.holdId).catch(() => {});
    }
    deleteOtpChallenge(venue._id, body.verificationId).catch(() => {});
    notifyConfirmation(new ObjectId(responseBody.id), venue._id, contactChannel, contact, responseBody.confirmationCode).catch(
      () => {},
    );

    res.status(201).json(responseBody);
  } catch (err) {
    if (
      err instanceof DomainError &&
      err.status !== 503 &&
      err.status !== 500 &&
      err.code !== ERROR_CODES.OTP_REQUIRED &&
      err.code !== ERROR_CODES.OTP_EXPIRED
    ) {
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
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 400, "Missing or malformed code.", parsed.error.flatten());
  }
  const bookingIdParam = req.params.bookingId;
  if (typeof bookingIdParam !== "string" || !ObjectId.isValid(bookingIdParam)) {
    throw new DomainError(ERROR_CODES.BOOKING_NOT_FOUND, 404, "No booking matches that id.");
  }
  const booking = await findBookingByConfirmationCode(new ObjectId(bookingIdParam), venue._id, parsed.data.code);
  if (!booking) throw new DomainError(ERROR_CODES.BOOKING_NOT_FOUND, 404, "No booking matches that id.");

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
      ERROR_CODES.VALIDATION_FAILED,
      400,
      "Invalid cancel request.",
      parsed.success ? undefined : parsed.error.flatten(),
    );
  }
  const bookingId = new ObjectId(bookingIdParam);
  const { confirmationCode } = parsed.data;

  const booking = await findBookingByConfirmationCode(bookingId, venue._id, confirmationCode);
  if (!booking) throw new DomainError(ERROR_CODES.BOOKING_NOT_FOUND, 404, "No booking matches that id.");

  const station = await findBookingStation(booking.stationId);
  if (!station) throw new Error("station referenced by booking not found");

  if (booking.status === "cancelled") {
    res.status(200).json(toBookingResponse(booking, station.name, station.kind, venue.timezone));
    return;
  }

  const nowMs = Date.now();
  if (nowMs >= booking.startsAt.getTime()) {
    throw new DomainError(ERROR_CODES.BOOKING_NOT_CANCELLABLE, 422, "This booking has already started or finished.");
  }

  const cancelledAt = new Date();
  const { lostRace } = await runCancelTransaction(bookingId, venue._id, booking.stationId, cancelledAt);

  const finalBooking = lostRace
    ? await findBookingById(bookingId, venue._id)
    : { ...booking, status: "cancelled" as const, cancelledAt };
  if (!finalBooking) throw new Error("booking vanished after a concurrent cancel");

  notifyCancellation(
    bookingId,
    venue._id,
    finalBooking.contactChannel,
    finalBooking.contact,
    finalBooking.confirmationCode,
  ).catch(() => {});

  res.status(200).json(toBookingResponse(finalBooking, station.name, station.kind, venue.timezone));
}

export async function lookupBookings(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const parsed = lookupBookingsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 400, "Invalid lookup request.", parsed.error.flatten());
  }
  const { value: verification, degraded } = await getOtpVerification(venue._id, parsed.data.verificationId);
  if (degraded) {
    throw new DomainError(ERROR_CODES.OTP_REQUIRED, 403, "OTP verification is temporarily unavailable.");
  }
  if (verification === null) {
    throw new DomainError(ERROR_CODES.OTP_EXPIRED, 410, "That verification has expired.");
  }
  if (!verification.verified) {
    throw new DomainError(ERROR_CODES.OTP_REQUIRED, 403, "Verification is required before looking up bookings.");
  }

  const bookingDocs = await findBookingsByContact(venue._id, verification.contact);
  const stationIds = [...new Map(bookingDocs.map((b) => [b.stationId.toHexString(), b.stationId])).values()];
  const stationDocs = await findStationsByIds(stationIds);
  const stationsById = new Map(stationDocs.map((s) => [s._id.toHexString(), s]));
  const bookings = bookingDocs.flatMap((b) => {
    const station = stationsById.get(b.stationId.toHexString());
    return station ? [toBookingResponse(b, station.name, station.kind, venue.timezone)] : [];
  });
  res.status(200).json({ bookings });
}
