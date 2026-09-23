import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  futureSessionCells,
  seedVenue,
  startTestServer,
  teardown,
  type TestServer,
  type TestVenue,
} from "#testing-support.js";

let server: TestServer;
let venue: TestVenue;

async function requestOtp(body: unknown): Promise<Response> {
  return fetch(`${server.baseUrl}/v1/venues/${venue.slug}/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function verifyOtp(body: unknown): Promise<Response> {
  return fetch(`${server.baseUrl}/v1/venues/${venue.slug}/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function emailContact(): { channel: "email"; email: string } {
  return { channel: "email", email: `test-${randomUUID().slice(0, 8)}@example.com` };
}

function smsContact(): { channel: "sms"; phone: string } {
  return { channel: "sms", phone: "9876543210" };
}

async function confirmBody(verificationId: string): Promise<unknown> {
  const { cellStartMs } = futureSessionCells(venue, 1);
  return {
    stationId: venue.stationIds[0]!.toHexString(),
    startsAt: new Date(cellStartMs[0]!).toISOString(),
    slotCount: 1,
    partySize: 1,
    player: { name: "Test Player" },
    verificationId,
  };
}

test("otp routes", async (t) => {
  try {
    server = await startTestServer();
    venue = await seedVenue({ maxSlots: 4 });

    await t.test("request then verify with the dev code succeeds (email)", async () => {
      const req = await requestOtp({ contact: emailContact() });
      assert.equal(req.status, 200);
      const reqBody = (await req.json()) as { verificationId: string; expiresAt: string; devCode?: string };
      assert.match(reqBody.verificationId, /^[0-9a-f-]{36}$/);
      assert.match(reqBody.devCode ?? "", /^\d{6}$/); // MOCK_OTP defaults true

      const verify = await verifyOtp({ verificationId: reqBody.verificationId, code: reqBody.devCode });
      assert.equal(verify.status, 200);
      const verifyBody = (await verify.json()) as { verified: boolean };
      assert.equal(verifyBody.verified, true);
    });

    await t.test("request then verify with the dev code succeeds (sms)", async () => {
      const req = await requestOtp({ contact: smsContact() });
      assert.equal(req.status, 200);
      const reqBody = (await req.json()) as { verificationId: string; devCode?: string };

      const verify = await verifyOtp({ verificationId: reqBody.verificationId, code: reqBody.devCode });
      assert.equal(verify.status, 200);
    });

    await t.test("a malformed contact is 400 VALIDATION_FAILED", async () => {
      const badEmail = await requestOtp({ contact: { channel: "email", email: "not-an-email" } });
      assert.equal(badEmail.status, 400);

      const badPhone = await requestOtp({ contact: { channel: "sms", phone: "12345" } });
      assert.equal(badPhone.status, 400);
    });

    await t.test("verifying the wrong code is 422 OTP_INVALID", async () => {
      const req = await requestOtp({ contact: emailContact() });
      const reqBody = (await req.json()) as { verificationId: string };

      const verify = await verifyOtp({ verificationId: reqBody.verificationId, code: "000000" });
      assert.equal(verify.status, 422);
      const body = (await verify.json()) as { error: { code: string } };
      assert.equal(body.error.code, "OTP_INVALID");
    });

    await t.test("verifying a verificationId that never requested a code is 410 OTP_EXPIRED", async () => {
      const verify = await verifyOtp({ verificationId: randomUUID(), code: "123456" });
      assert.equal(verify.status, 410);
      const body = (await verify.json()) as { error: { code: string } };
      assert.equal(body.error.code, "OTP_EXPIRED");
    });

    await t.test("5 wrong attempts, then a 6th is 429 OTP_TOO_MANY", async () => {
      const req = await requestOtp({ contact: emailContact() });
      const reqBody = (await req.json()) as { verificationId: string };

      for (let i = 0; i < 5; i++) {
        const attempt = await verifyOtp({ verificationId: reqBody.verificationId, code: "000000" });
        assert.equal(attempt.status, 422, `attempt ${i + 1} of 5 should still be OTP_INVALID`);
      }
      const sixth = await verifyOtp({ verificationId: reqBody.verificationId, code: "000000" });
      assert.equal(sixth.status, 429);
      const body = (await sixth.json()) as { error: { code: string } };
      assert.equal(body.error.code, "OTP_TOO_MANY");
    });

    await t.test("a 4th OTP request for the same contact is 429 OTP_TOO_MANY", async () => {
      const contact = emailContact();
      for (let i = 0; i < 3; i++) {
        const attempt = await requestOtp({ contact });
        assert.equal(attempt.status, 200, `request ${i + 1} of 3 should succeed`);
      }
      const fourth = await requestOtp({ contact });
      assert.equal(fourth.status, 429);
      const body = (await fourth.json()) as { error: { code: string } };
      assert.equal(body.error.code, "OTP_TOO_MANY");
      assert.ok(fourth.headers.get("Retry-After"));
    });

    await t.test("confirm with an unverified verificationId is 403 OTP_REQUIRED", async () => {
      const req = await requestOtp({ contact: emailContact() });
      const reqBody = (await req.json()) as { verificationId: string };

      const unverified = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify(await confirmBody(reqBody.verificationId)),
      });
      assert.equal(unverified.status, 403);
      const unverifiedBody = (await unverified.json()) as { error: { code: string } };
      assert.equal(unverifiedBody.error.code, "OTP_REQUIRED");
    });

    await t.test("confirm with a verificationId that was never requested is 410 OTP_EXPIRED", async () => {
      const res = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify(await confirmBody(randomUUID())),
      });
      assert.equal(res.status, 410);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "OTP_EXPIRED");
    });

    await t.test("verify then confirm succeeds, copies the contact onto the booking, and consumes the verification", async () => {
      const contact = emailContact();
      const req = await requestOtp({ contact });
      const reqBody = (await req.json()) as { verificationId: string; devCode?: string };
      const verify = await verifyOtp({ verificationId: reqBody.verificationId, code: reqBody.devCode });
      assert.equal(verify.status, 200);

      const confirmed = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify(await confirmBody(reqBody.verificationId)),
      });
      assert.equal(confirmed.status, 201);
      const confirmedBody = (await confirmed.json()) as { contactChannel: string; contact: string };
      assert.equal(confirmedBody.contactChannel, "email");
      assert.equal(confirmedBody.contact, contact.email);

      // Consumed on success: a second verify against the same
      // verificationId is gone, same as OTP_EXPIRED after a real TTL expiry.
      const staleVerify = await verifyOtp({ verificationId: reqBody.verificationId, code: reqBody.devCode });
      assert.equal(staleVerify.status, 410);
    });
  } finally {
    await teardown(venue, server);
  }
});
