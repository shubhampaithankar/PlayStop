import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { CreateHoldResponse } from "@playstop/types";
import { closeTestResources, futureSessionCells, seedVenue, startTestServer, wipeVenue, type TestServer, type TestVenue } from "#testing-support.js";

let server: TestServer;
let venue: TestVenue;

async function createHold(body: unknown): Promise<Response> {
  return fetch(`${server.baseUrl}/v1/venues/${venue.slug}/holds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function releaseHold(body: unknown): Promise<Response> {
  return fetch(`${server.baseUrl}/v1/venues/${venue.slug}/holds/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("hold routes", async (t) => {
  server = await startTestServer();
  venue = await seedVenue({ maxSlots: 4 });
  const stationId = venue.stationIds[0]!.toHexString();

  await t.test("acquires a hold across every cell in the range", async () => {
    const { cellStartMs } = futureSessionCells(venue, 2);
    const startsAt = new Date(cellStartMs[0]!).toISOString();
    const res = await createHold({ stationId, startsAt, slotCount: 2 });
    assert.equal(res.status, 201);
    const body = (await res.json()) as CreateHoldResponse;
    assert.equal(body.slotCount, 2);
    assert.equal(body.currency, "INR");

    // Release it so it doesn't collide with the tests below.
    const rel = await releaseHold({ holdId: body.holdId, stationId, startsAt, slotCount: 2 });
    assert.equal(rel.status, 204);
  });

  await t.test("slotCount outside the station's range is 422 SLOT_COUNT_OUT_OF_RANGE", async () => {
    const { cellStartMs } = futureSessionCells(venue, 1);
    const res = await createHold({
      stationId,
      startsAt: new Date(cellStartMs[0]!).toISOString(),
      slotCount: 5, // station's maxSlots is 4
    });
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "SLOT_COUNT_OUT_OF_RANGE");
  });

  await t.test("a station from another venue is 404 STATION_NOT_FOUND", async () => {
    const otherVenue = await seedVenue();
    const { cellStartMs } = futureSessionCells(venue, 1);
    const res = await createHold({
      stationId: otherVenue.stationIds[0]!.toHexString(),
      startsAt: new Date(cellStartMs[0]!).toISOString(),
      slotCount: 1,
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "STATION_NOT_FOUND");
    await wipeVenue(otherVenue.venueId);
  });

  // Test B (sequential, not 50-way: the concurrency proof lives in layer 3).
  await t.test("a second hold on an already-held range is 409 SLOT_HELD", async () => {
    const { cellStartMs } = futureSessionCells(venue, 2);
    const startsAt = new Date(cellStartMs[0]!).toISOString();
    const first = await createHold({ stationId, startsAt, slotCount: 2 });
    assert.equal(first.status, 201);
    const firstBody = (await first.json()) as CreateHoldResponse;

    const second = await createHold({ stationId, startsAt, slotCount: 2 });
    assert.equal(second.status, 409);
    const secondBody = (await second.json()) as { error: { code: string } };
    assert.equal(secondBody.error.code, "SLOT_HELD");

    await releaseHold({ holdId: firstBody.holdId, stationId, startsAt, slotCount: 2 });
  });

  // Test B2: overlapping ranges. A holds cells 0-2, B tries 2-4 and loses;
  // cells 3 and 4 must NOT be held afterward, proving the script wrote
  // nothing on a failed acquire.
  await t.test("an overlapping hold acquires nothing on failure", async () => {
    const { cellStartMs } = futureSessionCells(venue, 5);
    const startsAtA = new Date(cellStartMs[0]!).toISOString();
    const startsAtOverlap = new Date(cellStartMs[2]!).toISOString();
    const startsAtFree = new Date(cellStartMs[3]!).toISOString();

    const holdA = await createHold({ stationId, startsAt: startsAtA, slotCount: 3 }); // cells 0,1,2
    assert.equal(holdA.status, 201);
    const holdABody = (await holdA.json()) as CreateHoldResponse;

    const holdB = await createHold({ stationId, startsAt: startsAtOverlap, slotCount: 3 }); // cells 2,3,4
    assert.equal(holdB.status, 409);

    // Cells 3 and 4 must still be free: a hold on just those two succeeds.
    const holdFree = await createHold({ stationId, startsAt: startsAtFree, slotCount: 2 });
    assert.equal(holdFree.status, 201);
    const holdFreeBody = (await holdFree.json()) as CreateHoldResponse;

    await releaseHold({ holdId: holdABody.holdId, stationId, startsAt: startsAtA, slotCount: 3 });
    await releaseHold({ holdId: holdFreeBody.holdId, stationId, startsAt: startsAtFree, slotCount: 2 });
  });

  // Test H: release does not steal. Manually overwrite the held key to
  // simulate expiry-then-reacquisition by another client, then confirm the
  // original holder's release leaves the new owner's keys intact.
  await t.test("release only deletes cells this holder still owns", async () => {
    const { cellStartMs } = futureSessionCells(venue, 1);
    const startsAt = new Date(cellStartMs[0]!).toISOString();

    const holdA = await createHold({ stationId, startsAt, slotCount: 1 });
    assert.equal(holdA.status, 201);
    const holdABody = (await holdA.json()) as CreateHoldResponse;

    // Simulate expiry-then-reacquisition: release A's hold (as the TTL
    // would), then have B acquire the same cell.
    await releaseHold({ holdId: holdABody.holdId, stationId, startsAt, slotCount: 1 });
    const holdB = await createHold({ stationId, startsAt, slotCount: 1 });
    assert.equal(holdB.status, 201);
    const holdBBody = (await holdB.json()) as CreateHoldResponse;

    // A's stale release call must not touch B's live hold.
    const staleRelease = await releaseHold({ holdId: holdABody.holdId, stationId, startsAt, slotCount: 1 });
    assert.equal(staleRelease.status, 204);

    const stolen = await createHold({ stationId, startsAt, slotCount: 1 });
    assert.equal(stolen.status, 409); // still B's, so a third acquire fails

    await releaseHold({ holdId: holdBBody.holdId, stationId, startsAt, slotCount: 1 });
  });

  await t.test("releasing a range that was never on the grid is a no-op 204", async () => {
    const res = await releaseHold({
      holdId: randomUUID(),
      stationId,
      startsAt: "2026-08-07T08:07:00.000Z", // not aligned to any 30-minute cell
      slotCount: 1,
    });
    assert.equal(res.status, 204);
  });

  await wipeVenue(venue.venueId);
  await server.close();
  await closeTestResources();
});
