import assert from "node:assert/strict";
import { test } from "node:test";
import type { AvailabilityResponse, VenueResponse } from "@playstop/types";
import { closeTestResources, futureSessionCells, seedVenue, startTestServer, wipeVenue, type TestServer, type TestVenue } from "#testing-support.js";

// Layer 2 (spec section 9): shared Atlas dev database, one venue per file
// under a unique slug, no more than a handful of sequential requests.

let server: TestServer;
let venue: TestVenue;

test("venue routes", async (t) => {
  server = await startTestServer();
  venue = await seedVenue();

  await t.test("GET /venues/:slug returns the venue and its active stations", async () => {
    const res = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as VenueResponse;
    assert.equal(body.slug, venue.slug);
    assert.equal(body.stations.length, 1);
    assert.equal(body.gridMinutes, 30);
  });

  await t.test("GET /venues/:slug on an unknown slug is 404 VENUE_NOT_FOUND", async () => {
    const res = await fetch(`${server.baseUrl}/v1/venues/does-not-exist`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "VENUE_NOT_FOUND");
  });

  await t.test("GET /availability returns cells for the session, not degraded", async () => {
    const { businessDate } = futureSessionCells(venue, 1);
    const res = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/availability?date=${businessDate}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as AvailabilityResponse;
    assert.equal(body.closed, null);
    assert.equal(body.degraded, false);
    assert.equal(body.cells.length, 24); // 14:00 to 02:00, 30-minute grid
    assert.ok(body.cells.every((c) => c.state === "free"));
  });

  await t.test("GET /availability with a missing date is 400 VALIDATION_FAILED", async () => {
    const res = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/availability`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "VALIDATION_FAILED");
  });

  await t.test("GET /availability far beyond maxAdvanceDays is 422 DATE_OUT_OF_RANGE", async () => {
    const res = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/availability?date=2099-01-01`);
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "DATE_OUT_OF_RANGE");
  });

  await wipeVenue(venue.venueId);
  await server.close();
  await closeTestResources();
});
