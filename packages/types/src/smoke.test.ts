import { test } from "node:test";
import assert from "node:assert/strict";
import { healthResponseSchema } from "./api/health.js";
import { objectIdSchema, isoInstantSchema, localDateSchema } from "./common/primitives.js";
import { errorCodeSchema } from "./common/error.js";
import { cellStateSchema } from "./common/cell.js";
import { createBookingRequestSchema } from "./api/booking.js";

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

test("cellStateSchema matches the engine's CellState union", () => {
  for (const state of ["free", "held", "booked", "maintenance", "past", "too_far_ahead"]) {
    assert.equal(cellStateSchema.safeParse(state).success, true);
  }
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
