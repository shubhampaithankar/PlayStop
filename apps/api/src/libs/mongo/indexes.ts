import { collections } from "./index.js";

export async function createIndexes(): Promise<void> {
  await collections.venues().createIndex({ slug: 1 }, { unique: true });

  await collections.stations().createIndex({ venueId: 1, status: 1 });
  await collections.stations().createIndex({ venueId: 1, slug: 1 }, { unique: true });

  await collections.slotClaims().createIndex(
    { venueId: 1, cellStart: 1, stationId: 1 },
    { unique: true, partialFilterExpression: { status: "confirmed" }, name: "uniq_slot_claim" },
  );

  await collections
    .bookings()
    .createIndex({ venueId: 1, confirmationCode: 1 }, { unique: true, name: "uniq_booking_code" });

  await collections.bookings().createIndex({ venueId: 1, contact: 1 }, { name: "idx_booking_contact" });

  await collections.idempotency().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
