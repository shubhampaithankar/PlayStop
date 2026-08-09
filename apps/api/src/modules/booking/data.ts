import { MongoOperationTimeoutError, MongoServerError, type ObjectId } from "mongodb";
import { ERROR_CODES, type BookingResponse } from "@playstop/engine";
import { collections, mongoClient, type BookingDoc, type SlotClaimDoc, type StationDoc } from "#libs/mongo/index.js";
import { DomainError } from "#errors.js";

export interface BuiltConfirmDocs {
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

// No venueId/status filter: the caller already trusts booking ownership by
// this point, so this is just fetching the station's name/kind to render.
export function findBookingStation(stationId: ObjectId): Promise<StationDoc | null> {
  return collections.stations().findOne({ _id: stationId });
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

/**
 * The transaction, exactly per the cancel route's original inline body: a
 * concurrent cancel losing the updateOne race resolves to lostRace=true,
 * not an error, since Mongo serializes the two updateOne calls so exactly
 * one matches.
 */
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
