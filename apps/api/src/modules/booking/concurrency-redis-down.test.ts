// Spec section 9, layer 3, Test C: "Redis is UX, Mongo is truth", proven
// rather than asserted in a comment. CI only (see concurrency-confirm.test.ts
// for why).
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

test("C: Redis unreachable still yields exactly one booking, and availability reports degraded", { skip: !CI_ONLY }, async () => {
  process.env.REDIS_URL = "redis://127.0.0.1:65535"; // nothing listens here: fast, deterministic connection failure

  const { collections } = await import("#libs/mongo/index.js");
  const { closeTestResources, fireBurst, futureSessionCells, seedVenue, startTestServer, wipeVenue } = await import(
    "#testing-support.js"
  );

  const server = await startTestServer();
  const venue = await seedVenue({ maxSlots: 4 });
  const stationId = venue.stationIds[0]!.toHexString();
  const { businessDate, cellStartMs } = futureSessionCells(venue, 1);
  const startsAt = new Date(cellStartMs[0]!).toISOString();

  const N = 50;
  const { results, startSpreadMs } = await fireBurst(N, () => ({
    url: `${server.baseUrl}/v1/venues/${venue.slug}/bookings`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ stationId, startsAt, slotCount: 1, partySize: 1, player: { name: "Racer" } }),
    },
  }));
  assert.ok(startSpreadMs < 1000, `requests not observed to overlap (${startSpreadMs}ms spread)`);

  const classified = await Promise.all(
    results.map(async (r) => {
      if (r.status === "rejected") throw new Error(`fetch rejected: ${String(r.reason)}`);
      const res = r.value;
      if (res.status === 201) return { status: 201 };
      const body = (await res.json()) as { error: { code: string } };
      return { status: res.status, code: body.error.code };
    }),
  );
  assert.equal(classified.filter((c) => c.status === 201).length, 1);
  assert.equal(classified.filter((c) => c.status === 409 && c.code === "SLOT_TAKEN").length, N - 1);
  assert.equal(classified.filter((c) => c.status === 503).length, 0);

  const bookingCount = await collections.bookings().countDocuments({
    venueId: venue.venueId,
    stationId: venue.stationIds[0]!,
    startsAt: new Date(cellStartMs[0]!),
    status: "confirmed",
  });
  assert.equal(bookingCount, 1);

  const claimCount = await collections.slotClaims().countDocuments({
    venueId: venue.venueId,
    stationId: venue.stationIds[0]!,
    cellStart: new Date(cellStartMs[0]!),
    status: "confirmed",
  });
  assert.equal(claimCount, 1);

  const availRes = await fetch(
    `${server.baseUrl}/v1/venues/${venue.slug}/availability?date=${businessDate}&stationId=${stationId}`,
  );
  assert.equal(availRes.status, 200);
  const availBody = (await availRes.json()) as { degraded: boolean };
  assert.equal(availBody.degraded, true, "availability must report degraded when Redis is unreachable");

  await wipeVenue(venue.venueId);
  await server.close();
  await closeTestResources();
});
