import { test } from "node:test";
import assert from "node:assert/strict";
import { priceBooking } from "@playstop/engine";

test("priceBooking computes hourlyRateMinor * slotCount * gridMinutes / 60", () => {
  const total = priceBooking({ hourlyRateMinor: 15000 }, 30, 3);
  // 15000 * 3 * 30 / 60 = 22500
  assert.equal(total, 22_500);
});

test("priceBooking with a full hour of slots equals the hourly rate", () => {
  const total = priceBooking({ hourlyRateMinor: 20000 }, 30, 2);
  assert.equal(total, 20_000);
});

test("priceBooking throws when the amount would not be an integer", () => {
  assert.throws(() => priceBooking({ hourlyRateMinor: 13 }, 30, 1));
});
