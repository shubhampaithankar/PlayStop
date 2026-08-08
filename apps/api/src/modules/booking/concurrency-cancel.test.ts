// Spec section 9, layer 3, Test K2: concurrent double cancel. CI only (see
// concurrency-confirm.test.ts for why); 10 concurrent requests is real
// contention, past the layer-2 volume rule of 5.
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

test("K2: concurrent double cancel returns 200 everywhere with one cancelledAt", { skip: !CI_ONLY }, async () => {
  const { collections } = await import("#libs/mongo/index.js");
  const { closeTestResources, fireBurst, futureSessionCells, seedVenue, startTestServer, wipeVenue } = await import(
    "#testing-support.js"
  );

  const server = await startTestServer();
  const venue = await seedVenue();
  const stationId = venue.stationIds[0]!.toHexString();
  const { cellStartMs } = futureSessionCells(venue, 1);

  const booked = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
    body: JSON.stringify({
      stationId,
      startsAt: new Date(cellStartMs[0]!).toISOString(),
      slotCount: 1,
      partySize: 1,
      player: { name: "Racer" },
    }),
  });
  assert.equal(booked.status, 201);
  const bookedBody = (await booked.json()) as { id: string; confirmationCode: string };

  const { results, startSpreadMs } = await fireBurst(10, () => ({
    url: `${server.baseUrl}/v1/venues/${venue.slug}/bookings/${bookedBody.id}/cancel`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationCode: bookedBody.confirmationCode }),
    },
  }));
  assert.ok(startSpreadMs < 1000, `requests not observed to overlap (${startSpreadMs}ms spread)`);

  const bodies = await Promise.all(
    results.map(async (r) => {
      if (r.status === "rejected") throw new Error(`fetch rejected: ${String(r.reason)}`);
      assert.equal(r.value.status, 200, "every concurrent cancel must return 200");
      return (await r.value.json()) as { status: string; cancelledAt: string | null };
    }),
  );
  const cancelledAts = new Set(bodies.map((b) => b.cancelledAt));
  assert.equal(cancelledAts.size, 1, "cancelledAt must be identical across all ten responses");
  assert.ok(bodies.every((b) => b.status === "cancelled"));

  const claims = await collections
    .slotClaims()
    .find({ venueId: venue.venueId, stationId: venue.stationIds[0]!, cellStart: new Date(cellStartMs[0]!) })
    .toArray();
  assert.equal(claims.length, 1);
  assert.equal(claims[0]!.status, "cancelled");

  await wipeVenue(venue.venueId);
  await server.close();
  await closeTestResources();
});
