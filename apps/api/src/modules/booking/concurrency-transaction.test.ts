// Spec section 9, layer 3, Test I's concurrent variant. CI only (see
// concurrency-confirm.test.ts for why, including why every helper is
// imported dynamically inside the skipped callback rather than statically
// at the top of the file). The sequential form of Test I (book the middle
// cell, then attempt a 3-cell range across it, assert no orphan claim)
// already lives in booking/controller.test.ts as part of the low-volume
// layer 2 suite -- two sequential requests need no gating. This file is
// the general form: real contention, not a fixed loser.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const CI_ONLY = process.env.TEST_PROFILE === "ci";

// 20 concurrent 3-cell bookings whose ranges pairwise overlap without
// coinciding: request i claims cells [i, i+1, i+2]. No transaction, or a
// transaction that leaves a partial write on conflict, would show up as a
// claim count that doesn't match the survivors, or a claim pointing at a
// booking that isn't confirmed.
test(
  "I: concurrent overlapping multi-cell bookings leave no partial writes",
  { skip: !CI_ONLY },
  async () => {
    const { collections } = await import("#libs/mongo/index.js");
    const {
      closeTestResources,
      fireBurst,
      futureSessionCells,
      seedVenue,
      startTestServer,
      wipeVenue,
    } = await import("#testing-support.js");

    let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
    let venue: Awaited<ReturnType<typeof seedVenue>> | undefined;
    try {
      server = await startTestServer();
      venue = await seedVenue({ maxSlots: 4 });
      const stationId = venue.stationIds[0]!.toHexString();
      const REQUESTS = 20;
      const SLOT_COUNT = 3;
      const { cellStartMs } = futureSessionCells(venue, REQUESTS + SLOT_COUNT - 1);

      const { results, startSpreadMs } = await fireBurst(REQUESTS, (i) => ({
        url: `${server!.baseUrl}/v1/venues/${venue!.slug}/bookings`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
          body: JSON.stringify({
            stationId,
            startsAt: new Date(cellStartMs[i]!).toISOString(),
            slotCount: SLOT_COUNT,
            partySize: 1,
            player: { name: `Racer ${i}` },
          }),
        },
      }));
      assert.ok(
        startSpreadMs < 1000,
        `requests not observed to overlap (${startSpreadMs}ms spread)`,
      );

      const timeouts = await Promise.all(
        results.map(async (r) => {
          if (r.status === "rejected") throw new Error(`fetch rejected: ${String(r.reason)}`);
          return r.value.status === 503;
        }),
      );
      assert.equal(timeouts.filter(Boolean).length, 0, "expected zero BOOKING_TIMEOUT");

      const survivors = await collections
        .bookings()
        .find({ venueId: venue.venueId, stationId: venue.stationIds[0]!, status: "confirmed" })
        .toArray();
      assert.ok(survivors.length > 0, "expected at least one winner among 20 overlapping requests");

      // Pairwise disjoint cell ranges: no two survivors can occupy any of the
      // same cells, since a real conflict on any shared cell must have lost.
      const stride = venue.schedule.gridMinutes * 60_000;
      for (let a = 0; a < survivors.length; a++) {
        for (let b = a + 1; b < survivors.length; b++) {
          const startA = survivors[a]!.startsAt.getTime();
          const endA = startA + survivors[a]!.slotCount * stride;
          const startB = survivors[b]!.startsAt.getTime();
          const endB = startB + survivors[b]!.slotCount * stride;
          const overlaps = startA < endB && startB < endA;
          assert.ok(
            !overlaps,
            `survivors ${survivors[a]!._id.toHexString()} and ${survivors[b]!._id.toHexString()} overlap`,
          );
        }
      }

      const claims = await collections
        .slotClaims()
        .find({ venueId: venue.venueId, stationId: venue.stationIds[0]!, status: "confirmed" })
        .toArray();
      const expectedClaims = survivors.reduce(
        (sum, booking) => sum + booking.slotCount + booking.bufferSlotCount,
        0,
      );
      assert.equal(
        claims.length,
        expectedClaims,
        "confirmed claim count must equal the sum of survivors' cells",
      );

      const survivorIds = new Set(survivors.map((b) => b._id.toHexString()));
      assert.ok(
        claims.every((c) => survivorIds.has(c.bookingId.toHexString())),
        "no confirmed claim may point at a booking that isn't confirmed",
      );
    } finally {
      if (venue) await wipeVenue(venue.venueId);
      if (server) await server.close();
      await closeTestResources();
    }
  },
);
