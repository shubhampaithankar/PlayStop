import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRateLimit, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from "./rateLimit.js";

test("allows requests up to the limit within a window, then blocks", () => {
  const store = new Map();
  const now = 1_000_000;
  for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
    const result = checkRateLimit("venue:1.2.3.4", now, store);
    assert.equal(result.allowed, true);
  }
  const blocked = checkRateLimit("venue:1.2.3.4", now, store);
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.ok(blocked.retryAfterSeconds > 0);
});

test("resets once the window elapses", () => {
  const store = new Map();
  const now = 1_000_000;
  for (let i = 0; i <= RATE_LIMIT_MAX_REQUESTS; i++) checkRateLimit("k", now, store);
  const stillBlocked = checkRateLimit("k", now, store);
  assert.equal(stillBlocked.allowed, false);

  const afterWindow = checkRateLimit("k", now + RATE_LIMIT_WINDOW_MS + 1, store);
  assert.equal(afterWindow.allowed, true);
});

test("separate keys get independent budgets", () => {
  const store = new Map();
  const now = 1_000_000;
  for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) checkRateLimit("venueA:1.1.1.1", now, store);
  const other = checkRateLimit("venueB:1.1.1.1", now, store);
  assert.equal(other.allowed, true);
});
