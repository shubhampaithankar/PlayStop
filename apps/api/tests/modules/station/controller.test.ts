import assert from "node:assert/strict";
import { test } from "node:test";
import { stationCatalogResponseSchema } from "@playstop/engine";
import { seedVenue, startTestServer, teardown, type TestServer, type TestVenue } from "#testing-support.js";

let server: TestServer;
let venue: TestVenue;

test("station routes", async (t) => {
  try {
    server = await startTestServer();
    venue = await seedVenue();

    await t.test("GET /venues/:slug/stations returns the active station catalog", async () => {
      const res = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/stations`);
      assert.equal(res.status, 200);
      const body = stationCatalogResponseSchema.parse(await res.json());
      assert.equal(body.length, 1);
      assert.equal(body[0]?.slug, "station-1");
      assert.equal(body[0]?.kind, "ps5");
      assert.equal(body[0]?.capacity, 4);
      assert.equal(body[0]?.hourlyRateMinor, 1200);
    });

    await t.test("GET /venues/:slug/stations on an unknown slug is 404 VENUE_NOT_FOUND", async () => {
      const res = await fetch(`${server.baseUrl}/v1/venues/does-not-exist/stations`);
      assert.equal(res.status, 404);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "VENUE_NOT_FOUND");
    });
  } finally {
    await teardown(venue, server);
  }
});
