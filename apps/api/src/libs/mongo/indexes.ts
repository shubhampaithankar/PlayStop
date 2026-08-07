import { collections } from "./index.js";

// Every index from spec section 1, idempotent, run at boot before the HTTP
// listener starts. A running API without uniq_slot_claim is a correctness
// hazard, not a degraded mode, so boot must not proceed past a failure here.
export async function createIndexes(): Promise<void> {
  await collections.venues().createIndex({ slug: 1 }, { unique: true });

  await collections.stations().createIndex({ venueId: 1, status: 1 });
  await collections.stations().createIndex({ venueId: 1, slug: 1 }, { unique: true });

  // The correctness backstop. Key order (venueId, cellStart, stationId)
  // makes the availability window read a covered IXSCAN; see section 1.
  await collections.slotClaims().createIndex(
    { venueId: 1, cellStart: 1, stationId: 1 },
    { unique: true, partialFilterExpression: { status: "confirmed" }, name: "uniq_slot_claim" },
  );

  await collections
    .bookings()
    .createIndex({ venueId: 1, confirmationCode: 1 }, { unique: true, name: "uniq_booking_code" });

  // idempotency's _id is implicitly unique; only the TTL index is explicit.
  await collections.idempotency().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
