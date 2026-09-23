import { test } from "node:test";
import assert from "node:assert/strict";
import { countdownState, formatCountdown, remainingMsUntil } from "../../src/lib/countdown.js";

const EXPIRES_AT = "2026-08-29T12:00:00.000Z";
const at = (secondsBefore: number): number => Date.parse(EXPIRES_AT) - secondsBefore * 1000;

test("formatCountdown renders m:ss with a padded seconds field", () => {
  assert.equal(formatCountdown(272_000), "4:32");
  assert.equal(formatCountdown(41_000), "0:41");
  assert.equal(formatCountdown(60_000), "1:00");
  assert.equal(formatCountdown(0), "0:00");
});

test("formatCountdown truncates rather than rounds, so it never shows a second that has not elapsed", () => {
  // 41.9s remaining is still "0:41": rounding up would display 0:42 and let
  // the digits sit one second ahead of the hold the server actually holds.
  assert.equal(formatCountdown(41_900), "0:41");
});

test("remainingMsUntil never goes negative once the hold is gone", () => {
  assert.equal(remainingMsUntil(EXPIRES_AT, at(30)), 30_000);
  assert.equal(remainingMsUntil(EXPIRES_AT, at(0)), 0);
  assert.equal(remainingMsUntil(EXPIRES_AT, at(-120)), 0, "two minutes past expiry still clamps to 0");
});

test("urgent turns on strictly under 60 seconds, not at 60", () => {
  assert.equal(countdownState(EXPIRES_AT, at(61)).urgent, false);
  assert.equal(countdownState(EXPIRES_AT, at(60)).urgent, false, "exactly 60s is not yet the red state");
  assert.equal(countdownState(EXPIRES_AT, at(59)).urgent, true);
});

test("expired is derived from the clock, never stored, and is not also urgent", () => {
  const expired = countdownState(EXPIRES_AT, at(0));
  assert.equal(expired.expired, true);
  assert.equal(expired.urgent, false, "an expired hold is not 'hurry', it is over");
  assert.equal(expired.label, "0:00");
});

test("a tab that slept through the whole hold reports expired on its first tick", () => {
  // The interval is a tick source, not a counter: one late tick after a
  // four-minute sleep must land on the correct state, not on 3:59.
  const woken = countdownState(EXPIRES_AT, at(-240));
  assert.equal(woken.expired, true);
  assert.equal(woken.remainingMs, 0);
  assert.equal(woken.label, "0:00");
});
