import { createHash, randomBytes } from "node:crypto";
import { MongoOperationTimeoutError, MongoServerError, type ObjectId } from "mongodb";
import { ERROR_CODES, type BookingResponse, type CreateBookingRequest, type OtpChannel } from "@playstop/engine";
import { collections, mongoClient, type BookingDoc, type StationDoc } from "#libs/mongo/index.js";
import { DomainError } from "#errors.js";
import { notifyFor } from "#libs/notify/index.js";
import { IN_FLIGHT_STALE_MS, RETENTION_MS } from "#modules/booking/constants.js";
import { localLabelOf } from "#modules/venue/utils.js";
import type { BookingResponseSource, BuiltConfirmDocs, IdempotencyClaim } from "#types/booking.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateConfirmationCode(): string {
  return confirmationCodeFromBytes(randomBytes(10));
}

export function confirmationCodeFromBytes(bytes: Uint8Array): string {
  let code = "";
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}

export function toBookingResponse(
  booking: BookingResponseSource,
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
    contactChannel: booking.contactChannel ?? null,
    contact: booking.contact ?? null,
    createdAt: booking.createdAt.toISOString(),
    cancelledAt: booking.cancelledAt ? booking.cancelledAt.toISOString() : null,
    confirmationSentAt: booking.confirmationSentAt ? booking.confirmationSentAt.toISOString() : null,
    cancellationSentAt: booking.cancellationSentAt ? booking.cancellationSentAt.toISOString() : null,
    nudgeSentAt: booking.nudgeSentAt ? booking.nudgeSentAt.toISOString() : null,
  };
}

export function toBookingPlayer(player: CreateBookingRequest["player"]): BookingDoc["player"] {
  const result: BookingDoc["player"] = { name: player.name };
  if (player.email !== undefined) result.email = player.email;
  if (player.phone !== undefined) result.phone = player.phone;
  return result;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function hashRequest(validatedBody: unknown): string {
  return createHash("sha256").update(canonicalJson(validatedBody)).digest("hex");
}

export async function runConfirmTransaction(
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
      throw new DomainError(ERROR_CODES.BOOKING_TIMEOUT, 503, "Could not confirm in time. Try again.", undefined, {
        "Retry-After": "2",
      });
    }
    if (err instanceof MongoServerError && err.code === 11000) {
      if (err.message.includes("uniq_slot_claim")) {
        throw new DomainError(ERROR_CODES.SLOT_TAKEN, 409, "Part of that time was just booked by someone else.");
      }
      if (err.message.includes("uniq_booking_code")) {
        throw new DomainError(ERROR_CODES.INTERNAL, 500, "Could not generate a unique confirmation code.");
      }
    }
    throw err;
  } finally {
    await session.endSession();
  }
}


export async function claimIdempotency(
  venueId: ObjectId,
  key: string,
  requestHash: string,
  now: Date,
): Promise<IdempotencyClaim> {
  const id = `${venueId.toHexString()}:${key}`;
  try {
    await collections.idempotency().insertOne({
      _id: id,
      venueId,
      key,
      requestHash,
      state: "in_flight",
      createdAt: now,
      expiresAt: new Date(now.getTime() + RETENTION_MS),
    });
    return { outcome: "claimed", id };
  } catch (err) {
    if (!(err instanceof MongoServerError && err.code === 11000)) throw err;
  }

  const existing = await collections.idempotency().findOne({ _id: id });
  if (!existing) {
    return claimIdempotency(venueId, key, requestHash, now);
  }

  if (existing.requestHash !== requestHash) {
    throw new DomainError(
      ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
      422,
      "This idempotency key was already used for a different request.",
    );
  }

  if (existing.state === "completed" || existing.state === "failed") {
    return { outcome: "replay", statusCode: existing.statusCode ?? 500, response: existing.response };
  }

  const takeover = await collections.idempotency().updateOne(
    { _id: id, state: "in_flight", createdAt: { $lt: new Date(now.getTime() - IN_FLIGHT_STALE_MS) } },
    { $set: { createdAt: now } },
  );
  if (takeover.modifiedCount === 1) {
    return { outcome: "claimed", id };
  }
  throw new DomainError(ERROR_CODES.REQUEST_IN_FLIGHT, 409, "This request is already being processed.", undefined, {
    "Retry-After": "1",
  });
}

export async function finalizeFailure(id: string, statusCode: number, response: unknown): Promise<void> {
  await collections.idempotency().updateOne({ _id: id }, { $set: { state: "failed", statusCode, response } });
}

export async function abandonClaim(id: string): Promise<void> {
  await collections.idempotency().deleteOne({ _id: id });
}

async function notifyOnce(
  bookingId: ObjectId,
  venueId: ObjectId,
  stampField: "confirmationSentAt" | "cancellationSentAt",
  contactChannel: OtpChannel | null | undefined,
  contact: string | null | undefined,
  subject: string,
  text: string,
): Promise<void> {
  if (!contactChannel || !contact) return;
  const result = await collections
    .bookings()
    .updateOne({ _id: bookingId, venueId, [stampField]: null }, { $set: { [stampField]: new Date() } });
  if (result.matchedCount === 1) {
    await notifyFor(contactChannel).send({ to: contact, subject, text });
  }
}

export function notifyConfirmation(
  bookingId: ObjectId,
  venueId: ObjectId,
  contactChannel: OtpChannel | null | undefined,
  contact: string | null | undefined,
  confirmationCode: string,
): Promise<void> {
  return notifyOnce(
    bookingId,
    venueId,
    "confirmationSentAt",
    contactChannel,
    contact,
    "Your PlayStop booking is confirmed",
    `Booking confirmed. Your confirmation code is ${confirmationCode}.`,
  );
}

export function notifyCancellation(
  bookingId: ObjectId,
  venueId: ObjectId,
  contactChannel: OtpChannel | null | undefined,
  contact: string | null | undefined,
  confirmationCode: string,
): Promise<void> {
  return notifyOnce(
    bookingId,
    venueId,
    "cancellationSentAt",
    contactChannel,
    contact,
    "Your PlayStop booking is cancelled",
    `Booking ${confirmationCode} has been cancelled.`,
  );
}

export function findBookingStation(stationId: ObjectId): Promise<StationDoc | null> {
  return collections.stations().findOne({ _id: stationId });
}

export function findBookingsByContact(venueId: ObjectId, contact: string): Promise<BookingDoc[]> {
  return collections.bookings().find({ venueId, contact }).sort({ startsAt: -1 }).limit(100).toArray();
}

export function findStationsByIds(ids: ObjectId[]): Promise<StationDoc[]> {
  return collections.stations().find({ _id: { $in: ids } }).toArray();
}

export function findBookingByConfirmationCode(
  bookingId: ObjectId,
  venueId: ObjectId,
  confirmationCode: string,
): Promise<BookingDoc | null> {
  return collections.bookings().findOne({ _id: bookingId, venueId, confirmationCode });
}

export function findBookingById(bookingId: ObjectId, venueId: ObjectId): Promise<BookingDoc | null> {
  return collections.bookings().findOne({ _id: bookingId, venueId });
}

export class ConcurrentCancelError extends Error {}

export async function runCancelTransaction(
  bookingId: ObjectId,
  venueId: ObjectId,
  stationId: ObjectId,
  cancelledAt: Date,
): Promise<{ lostRace: boolean }> {
  const session = mongoClient().startSession();
  try {
    await session.withTransaction(
      async () => {
        const updateResult = await collections.bookings().updateOne(
          { _id: bookingId, venueId, status: "confirmed" },
          { $set: { status: "cancelled", cancelledAt } },
          { session },
        );
        if (updateResult.matchedCount === 0) throw new ConcurrentCancelError();
        await collections.slotClaims().updateMany(
          { venueId, stationId, bookingId, status: "confirmed" },
          { $set: { status: "cancelled" } },
          { session },
        );
      },
      { readConcern: { level: "local" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 8000 },
    );
    return { lostRace: false };
  } catch (err) {
    if (err instanceof ConcurrentCancelError) {
      return { lostRace: true };
    }
    if (err instanceof MongoOperationTimeoutError) {
      throw new DomainError(ERROR_CODES.BOOKING_TIMEOUT, 503, "Could not cancel in time. Try again.", undefined, {
        "Retry-After": "2",
      });
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
