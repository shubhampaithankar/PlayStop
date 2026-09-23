// Milestone 3 spec section 13, cases 9 and 10: the error parsing in
// lib/api.ts against a stubbed fetch. No browser, no running API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { otpContactSchema } from "@playstop/engine";
import { getVenue, ApiRequestError, playerFieldErrors, requestOtp, verifyOtp } from "../../src/lib/api.js";

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

test("playerFieldErrors reads nested fieldErrors.player.{name,phone} and formErrors", () => {
  const details = { fieldErrors: { player: { name: ["Too short"], phone: ["Invalid"] } }, formErrors: [] };
  assert.deepEqual(playerFieldErrors(details), { name: "Too short", phone: "Invalid", email: undefined, panel: null });
});

test("playerFieldErrors falls back to dotted fieldErrors keys", () => {
  const details = { fieldErrors: { "player.name": ["Too short"] }, formErrors: ["Bad request"] };
  assert.deepEqual(playerFieldErrors(details), {
    name: "Too short",
    phone: undefined,
    email: undefined,
    panel: "Bad request",
  });
});

test("playerFieldErrors tolerates a non-object details value", () => {
  assert.deepEqual(playerFieldErrors(undefined), { panel: null });
  assert.deepEqual(playerFieldErrors("oops"), { panel: null });
});

test("playerFieldErrors reads a player.email error the same way as player.phone", () => {
  const details = { fieldErrors: { player: { email: ["Invalid email"] } }, formErrors: [] };
  assert.deepEqual(playerFieldErrors(details), {
    name: undefined,
    phone: undefined,
    email: "Invalid email",
    panel: null,
  });
});

// booking-guardrails-otp-design.v3: the contact discriminated union the web
// form validates against before ever calling /otp/request (book.station.tsx
// reuses this same schema, so these cases double as its coverage).
test("otpContactSchema: a valid India mobile number normalizes to the last 10 digits", () => {
  const parsed = otpContactSchema.safeParse({ channel: "sms", phone: "+91 98765 43210".replace(/\s/g, "") });
  assert.ok(parsed.success);
  if (parsed.success) assert.equal(parsed.data.channel === "sms" ? parsed.data.phone : null, "9876543210");
});

test("otpContactSchema: a number not starting 6-9 is rejected", () => {
  assert.equal(otpContactSchema.safeParse({ channel: "sms", phone: "5876543210" }).success, false);
});

test("otpContactSchema: an email is trimmed and lowercased", () => {
  const parsed = otpContactSchema.safeParse({ channel: "email", email: "  Player@Example.com  " });
  assert.ok(parsed.success);
  if (parsed.success) assert.equal(parsed.data.channel === "email" ? parsed.data.email : null, "player@example.com");
});

test("otpContactSchema: a malformed email is rejected", () => {
  assert.equal(otpContactSchema.safeParse({ channel: "email", email: "not-an-email" }).success, false);
});

function stubFetchCapture(response: Response): { restore: () => void; calls: { url: string; body: unknown }[] } {
  const original = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : undefined });
    return response;
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("requestOtp posts { contact } to /otp/request", async () => {
  const { calls, restore } = stubFetchCapture(
    new Response(JSON.stringify({ verificationId: "11111111-1111-1111-1111-111111111111", expiresAt: "2026-09-23T20:00:00.000Z" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  try {
    await requestOtp({ contact: { channel: "email", email: "player@example.com" } });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.ok(call.url.endsWith("/otp/request"));
    assert.deepEqual(call.body, { contact: { channel: "email", email: "player@example.com" } });
  } finally {
    restore();
  }
});

test("verifyOtp posts { verificationId, code } to /otp/verify", async () => {
  const { calls, restore } = stubFetchCapture(
    new Response(JSON.stringify({ verified: true }), { status: 200, headers: { "content-type": "application/json" } }),
  );
  try {
    await verifyOtp({ verificationId: "11111111-1111-1111-1111-111111111111", code: "123456" });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.ok(call.url.endsWith("/otp/verify"));
    assert.deepEqual(call.body, { verificationId: "11111111-1111-1111-1111-111111111111", code: "123456" });
  } finally {
    restore();
  }
});
