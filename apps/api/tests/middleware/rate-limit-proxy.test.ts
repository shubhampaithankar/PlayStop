// Proves app.ts's `trust proxy` setting actually reaches the mounted
// rateLimit middleware (unlike rate-limit.test.ts, which only exercises the
// pure checkRateLimit function with a fabricated key and would pass even if
// the middleware were unmounted from every route). Without `trust proxy`,
// req.ip is Render's proxy address for every client, so distinct clients
// collapse onto one shared bucket -- this is the exact defect the fix closes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RATE_LIMIT_MAX_REQUESTS } from "#middleware/rate-limit.js";
import { seedVenue, startTestServer, teardown, type TestServer, type TestVenue } from "#testing-support.js";

let server: TestServer;
let venue: TestVenue;

async function postHold(clientIp: string): Promise<Response> {
  return fetch(`${server.baseUrl}/v1/venues/${venue.slug}/holds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": clientIp },
    // Body is deliberately invalid: rateLimit is mounted before the
    // controller, so it runs (and can 429) regardless of body validity.
    body: "{}",
  });
}

test("rate limit middleware", async (t) => {
  try {
    server = await startTestServer();
    venue = await seedVenue({ maxSlots: 4 });

    await t.test("distinct X-Forwarded-For clients get distinct buckets, none rate limited", async () => {
      const requestCount = RATE_LIMIT_MAX_REQUESTS + 5;
      for (let i = 0; i < requestCount; i++) {
        const res = await postHold(`10.0.0.${i}`);
        assert.notEqual(res.status, 429, `client 10.0.0.${i} was rate limited, buckets are shared`);
      }
    });

    await t.test("one client's repeated requests exhaust its own bucket", async () => {
      const clientIp = "10.1.1.1";
      const statuses: number[] = [];
      for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS + 1; i++) {
        statuses.push((await postHold(clientIp)).status);
      }
      assert.ok(statuses.includes(429), "same-client requests never hit the limit");
    });
  } finally {
    await teardown(venue, server);
  }
});
