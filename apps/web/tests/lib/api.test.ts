// Milestone 3 spec section 13, cases 9 and 10: the error parsing in
// lib/api.ts against a stubbed fetch. No browser, no running API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getVenue, ApiRequestError } from "../../src/lib/api.js";

process.env.VITE_API_URL = "http://api.test";
process.env.VITE_VENUE_SLUG = "test-venue";

function stubFetch(response: Response): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("request turns a structured 409 body into an ApiRequestError with the right code and requestId", async () => {
  const body = {
    error: {
      code: "SLOT_TAKEN",
      message: "Part of 19:30 to 20:30 was just booked.",
      requestId: "req-123",
    },
  };
  const restore = stubFetch(
    new Response(JSON.stringify(body), { status: 409, headers: { "content-type": "application/json" } }),
  );
  try {
    await assert.rejects(getVenue(), (err: unknown) => {
      assert.ok(err instanceof ApiRequestError);
      assert.equal(err.code, "SLOT_TAKEN");
      assert.equal(err.status, 409);
      assert.equal(err.requestId, "req-123");
      assert.equal(err.message, "Part of 19:30 to 20:30 was just booked.");
      return true;
    });
  } finally {
    restore();
  }
});

test('request turns a 502 with an HTML body into ApiRequestError("INTERNAL") rather than throwing a SyntaxError', async () => {
  const restore = stubFetch(new Response("<html>Bad Gateway</html>", { status: 502 }));
  try {
    await assert.rejects(getVenue(), (err: unknown) => {
      assert.ok(err instanceof ApiRequestError);
      assert.equal(err.code, "INTERNAL");
      assert.equal(err.status, 502);
      assert.equal(err.requestId, "unknown");
      return true;
    });
  } finally {
    restore();
  }
});
