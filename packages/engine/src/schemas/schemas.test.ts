import { test } from "node:test";
import assert from "node:assert/strict";
import { healthResponseSchema } from "./health.js";
import { objectIdSchema, isoInstantSchema, localDateSchema } from "./primitives.js";
import { errorCodeSchema } from "./error.js";
import { createBookingRequestSchema } from "./booking.js";

test("healthResponseSchema accepts the documented shape", () => {
  const parsed = healthResponseSchema.parse({ status: "ok", uptime: 12.5 });
  assert.equal(parsed.status, "ok");
});

test("objectIdSchema accepts a 24-char hex string and rejects anything else", () => {
  assert.equal(objectIdSchema.safeParse("507f1f77bcf86cd799439011").success, true);
  assert.equal(objectIdSchema.safeParse("not-an-object-id").success, false);
});

test("isoInstantSchema requires a literal Z, rejecting an explicit offset", () => {
  assert.equal(isoInstantSchema.safeParse("2026-11-01T01:30:00.000Z").success, true);
  assert.equal(isoInstantSchema.safeParse("2026-11-01T01:30:00.000-04:00").success, false);
});

test("localDateSchema accepts YYYY-MM-DD only", () => {
  assert.equal(localDateSchema.safeParse("2026-08-07").success, true);
  assert.equal(localDateSchema.safeParse("2026/08/07").success, false);
});

test("errorCodeSchema is a closed enum", () => {
  assert.equal(errorCodeSchema.safeParse("SLOT_TAKEN").success, true);
  assert.equal(errorCodeSchema.safeParse("NOT_A_REAL_CODE").success, false);
});

test("createBookingRequestSchema rejects a body missing the player", () => {
  const result = createBookingRequestSchema.safeParse({
    stationId: "507f1f77bcf86cd799439011",
    startsAt: "2026-08-07T08:30:00.000Z",
    slotCount: 2,
    partySize: 3,
  });
  assert.equal(result.success, false);
});
