// Spec section 9, layer 3, Test C: was "Redis is UX, Mongo is truth" for the
// whole confirm path. The OTP pivot (2026-09-23 design v3) narrows that:
// holds still degrade open, but OTP verification is now a required
// Redis-backed gate that does NOT degrade open (docs/conventions/
// booking-correctness.md). So the proof this test carries now is the
// mirror of the old one -- Redis unreachable blocks every confirm with
// OTP_REQUIRED, writes nothing, while availability (unrelated to OTP)
// still degrades open and reports degraded:true. CI only (see
// concurrency-confirm.test.ts for why).
//
// REDIS_URL is overridden to a closed port before any module that reads it
// is imported. env.ts (and everything downstream: redis.ts, app.ts,
// testing-support.ts) parses process.env once, at module load time, so the
// override must land before the first `import` of any of them executes.
// ESM static imports are hoisted and resolved before this file's own body
// runs, so the override has to happen here and the app modules have to be
// reached via dynamic import() afterward -- that is the "separate env var
// the file reads to point at a closed port" the brief asks for, done
// without touching the shared redis client any other test file uses.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const CI_ONLY = process.env.TEST_PROFILE === "ci";

test(
  "C: Redis unreachable blocks every confirm (OTP_REQUIRED), writes nothing, and availability still reports degraded",
  { skip: !CI_ONLY },
  async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:65535"; // nothing listens here: fast, deterministic connection failure
    // 50 concurrent requests to one venue share one rate-limit bucket; the
    // real limit of 30 would reject some before booking logic runs. Same
    // pre-import ordering requirement as REDIS_URL above.
    process.env.RATE_LIMIT_MAX_REQUESTS = "200";

    const { collections } = await import("#libs/mongo/index.js");
    const { fireBurst, futureSessionCells, seedVenue, startTestServer, teardown } = await import(
      "#testing-support.js"
    );

    let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
    let venue: Awaited<ReturnType<typeof seedVenue>> | undefined;
    try {
      server = await startTestServer();
      venue = await seedVenue({ maxSlots: 4 });
      const stationId = venue.stationIds[0]!.toHexString();
      const { businessDate, cellStartMs } = futureSessionCells(venue, 1);
      const startsAt = new Date(cellStartMs[0]!).toISOString();
      // Redis is unreachable for this whole process (REDIS_URL was pointed
      // at a closed port before any module import), so there is no real
      // verificationId to mint -- the OTP gate can never read one back
      // either way. Any well-formed uuid exercises the same degraded path.
      const verificationId = randomUUID();

      const N = 50;
      const { results, startSpreadMs } = await fireBurst(N, () => ({
        url: `${server!.baseUrl}/v1/venues/${venue!.slug}/bookings`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
          body: JSON.stringify({
            stationId,
            startsAt,
            slotCount: 1,
            partySize: 1,
            player: { name: "Racer" },
            verificationId,
          }),
        },
      }));
      assert.ok(
        startSpreadMs < 1000,
        `requests not observed to overlap (${startSpreadMs}ms spread)`,
      );

      const classified = await Promise.all(
        results.map(async (r) => {
          if (r.status === "rejected") throw new Error(`fetch rejected: ${String(r.reason)}`);
          const res = r.value;
          if (res.status === 201) return { status: 201 };
          const body = (await res.json()) as { error: { code: string } };
          return { status: res.status, code: body.error.code };
        }),
      );
      // The hold check still degrades open (no holdId here anyway), but the
      // OTP gate does not: every request is blocked before it ever reaches
      // the Mongo transaction.
      assert.equal(classified.filter((c) => c.status === 201).length, 0);
      assert.equal(
        classified.filter((c) => c.status === 403 && c.code === "OTP_REQUIRED").length,
        N,
      );
      assert.equal(classified.filter((c) => c.status === 503).length, 0);

      const bookingCount = await collections.bookings().countDocuments({
        venueId: venue.venueId,
        stationId: venue.stationIds[0]!,
        startsAt: new Date(cellStartMs[0]!),
      });
      assert.equal(bookingCount, 0);

      const claimCount = await collections.slotClaims().countDocuments({
        venueId: venue.venueId,
        stationId: venue.stationIds[0]!,
        cellStart: new Date(cellStartMs[0]!),
      });
      assert.equal(claimCount, 0);

      const availRes = await fetch(
        `${server.baseUrl}/v1/venues/${venue.slug}/availability?date=${businessDate}&stationId=${stationId}`,
      );
      assert.equal(availRes.status, 200);
      const availBody = (await availRes.json()) as { degraded: boolean };
      assert.equal(
        availBody.degraded,
        true,
        "availability must report degraded when Redis is unreachable",
      );
    } finally {
      await teardown(venue, server);
    }
  },
);
