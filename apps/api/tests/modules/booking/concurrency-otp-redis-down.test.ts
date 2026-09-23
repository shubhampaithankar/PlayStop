// Spec section 0/1 (2026-09-23 design v3): OTP verification is now a
// required Redis-backed gate and does NOT degrade open, unlike the hold
// check it sits beside. This is the deliberate SLA narrowing documented in
// docs/conventions/booking-correctness.md -- Redis down blocks new
// bookings. CI only, same reasoning and REDIS_URL/dynamic import ordering
// as concurrency-redis-down.test.ts.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const CI_ONLY = process.env.TEST_PROFILE === "ci";

test(
  "a confirm is blocked (403 OTP_REQUIRED) when Redis is unreachable, even with a holdId",
  { skip: !CI_ONLY },
  async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:65535"; // nothing listens here

    const { futureSessionCells, seedVenue, startTestServer, teardown } = await import("#testing-support.js");

    let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
    let venue: Awaited<ReturnType<typeof seedVenue>> | undefined;
    try {
      server = await startTestServer();
      venue = await seedVenue({ maxSlots: 4 });
      const stationId = venue.stationIds[0]!.toHexString();
      const { cellStartMs } = futureSessionCells(venue, 1);
      const startsAt = new Date(cellStartMs[0]!).toISOString();

      // A holdId that was never actually acquired: with Redis reachable
      // this would be SLOT_HELD/HOLD_EXPIRED at the hold check. With Redis
      // unreachable, the hold check itself still degrades open (unchanged),
      // but the OTP gate that follows does not -- it blocks the confirm
      // outright, regardless of holdId.
      const res = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify({
          stationId,
          startsAt,
          slotCount: 1,
          partySize: 1,
          player: { name: "Racer" },
          holdId: randomUUID(),
          verificationId: randomUUID(),
        }),
      });
      assert.equal(res.status, 403);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "OTP_REQUIRED");
    } finally {
      await teardown(venue, server);
    }
  },
);
