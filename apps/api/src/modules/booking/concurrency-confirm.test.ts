// Spec section 9, layer 3: the concurrency proof. CI only. A developer
// running `pnpm test` gets this file skipped, never a throttled Atlas
// cluster; CI sets TEST_PROFILE=ci and runs it against the replica-set
// service in .github/workflows/ci.yml.
//
// Every helper is imported dynamically, inside the skipped test callback,
// rather than statically at the top of the file. testing-support.js
// transitively imports app.js, which constructs the module-level ioredis
// client as an import-time side effect; a static import would open that
// connection even when skip:true means the callback body -- and the
// closeTestResources() at its end -- never runs, leaving the child process
// alive forever on a developer machine running plain `pnpm test`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const CI_ONLY = process.env.TEST_PROFILE === "ci";

// Test A alone fires 50 requests x 20 rounds at one venue, all sharing one
// rate-limit bucket (keyed by venueId:ip) inside the same fixed 60s window;
// the real limit of 30 would reject most of them before booking logic ever
// runs. Set at module scope, before either test's dynamic import() of the
// app modules, same ordering requirement as REDIS_URL in
// concurrency-redis-down.test.ts: env.ts reads process.env once, at import
// time. Overridden only in this process, never in production or the
// default `pnpm test` run.
process.env.RATE_LIMIT_MAX_REQUESTS = "2000";

interface Classified {
  readonly status: number;
  readonly code?: string;
}

async function classify(result: PromiseSettledResult<Response>): Promise<Classified> {
  if (result.status === "rejected") throw new Error(`fetch rejected: ${String(result.reason)}`);
  const res = result.value;
  if (res.status === 201) return { status: 201 };
  const body = (await res.json()) as { error: { code: string } };
  return { status: res.status, code: body.error.code };
}

// Test A: the proof the whole milestone rests on. 50 concurrent confirms
// for the same cell, 50 DISTINCT idempotency keys (so the idempotency
// layer cannot dedupe the race), no holdId in any request (so the Redis
// hold cannot serialize them). Repeated 20 times with a fresh cell every
// round: a single round can pass on timing luck.
test("A: N concurrent confirms yield exactly one booking", { skip: !CI_ONLY }, async () => {
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
  // finally so a failed assertion mid-round still closes the server, Mongo
  // pool, and ioredis client instead of hanging the file (an unclosed
  // ioredis client retries forever, keeping the event loop alive).
  try {
    server = await startTestServer();
    venue = await seedVenue({ maxSlots: 4 });
    const stationId = venue.stationIds[0]!.toHexString();
    const N = 50;
    const ROUNDS = 20;

    for (let round = 0; round < ROUNDS; round++) {
      const { cellStartMs } = futureSessionCells(venue, 1);
      const startsAt = new Date(cellStartMs[0]!).toISOString();

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
          }),
        },
      }));
      assert.ok(
        startSpreadMs < 1000,
        `round ${round}: requests not observed to overlap (${startSpreadMs}ms spread)`,
      );

      const classified = await Promise.all(results.map(classify));
      const winners = classified.filter((c) => c.status === 201);
      const conflicts = classified.filter((c) => c.status === 409 && c.code === "SLOT_TAKEN");
      const timeouts = classified.filter((c) => c.status === 503);

      assert.equal(
        winners.length,
        1,
        `round ${round}: expected exactly one 201, got ${winners.length}`,
      );
      assert.equal(
        conflicts.length,
        N - 1,
        `round ${round}: expected ${N - 1} SLOT_TAKEN, got ${conflicts.length}`,
      );
      assert.equal(
        timeouts.length,
        0,
        `round ${round}: expected zero BOOKING_TIMEOUT, got ${timeouts.length}`,
      );

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
    }
  } finally {
    if (venue) await wipeVenue(venue.venueId);
    if (server) await server.close();
    await closeTestResources();
  }
});

// Test D: 20 concurrent requests, the SAME idempotency key and the SAME
// body. The idempotency claim (an atomic insertOne on _id) must let exactly
// one through to the transaction; every other response must be a 409
// REQUEST_IN_FLIGHT, never a SLOT_TAKEN, which would mean the idempotency
// layer let a duplicate reach the insert.
test(
  "D: concurrent identical-key retries yield exactly one booking",
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
      const { cellStartMs } = futureSessionCells(venue, 1);
      const startsAt = new Date(cellStartMs[0]!).toISOString();
      const key = randomUUID();

      const { results, startSpreadMs } = await fireBurst(20, () => ({
        url: `${server!.baseUrl}/v1/venues/${venue!.slug}/bookings`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({
            stationId,
            startsAt,
            slotCount: 1,
            partySize: 1,
            player: { name: "Racer" },
          }),
        },
      }));
      assert.ok(
        startSpreadMs < 1000,
        `requests not observed to overlap (${startSpreadMs}ms spread)`,
      );

      const classified = await Promise.all(results.map(classify));
      for (const c of classified) {
        assert.ok(
          c.status === 201 || (c.status === 409 && c.code === "REQUEST_IN_FLIGHT"),
          `unexpected response: ${c.status} ${c.code ?? ""}`,
        );
        assert.notEqual(
          c.code,
          "SLOT_TAKEN",
          "the idempotency layer let a duplicate reach the insert",
        );
      }
      assert.ok(
        classified.some((c) => c.status === 201),
        "no request ever won or replayed",
      );

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
    } finally {
      if (venue) await wipeVenue(venue.venueId);
      if (server) await server.close();
      await closeTestResources();
    }
  },
);
