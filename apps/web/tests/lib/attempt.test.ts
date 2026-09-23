import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyReload, clearAttempt, readAttempt, type BookingAttempt, writeAttempt } from "../../src/lib/attempt.js";

// Tiny in-memory Storage stand-in -- no DOM test library, per project convention.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function withStubStorage(run: () => void): void {
  const stub = new MemoryStorage();
  Object.defineProperty(globalThis, "sessionStorage", { value: stub, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, "sessionStorage", { value: undefined, configurable: true });
  }
}

function sampleAttempt(overrides: Partial<BookingAttempt> = {}): BookingAttempt {
  return {
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    stationId: "station-1",
    startsAt: "2026-08-28T20:30:00.000Z",
    slotCount: 4,
    hold: null,
    submitted: null,
    outcomeUnknown: false,
    ...overrides,
  };
}

test("round trip: write then read returns the same attempt", () => {
  withStubStorage(() => {
    const attempt = sampleAttempt();
    writeAttempt(attempt);
    assert.deepEqual(readAttempt(), attempt);
  });
});

test("absent key returns null", () => {
  withStubStorage(() => {
    assert.equal(readAttempt(), null);
  });
});

test("corrupt JSON returns null and clears the key", () => {
  withStubStorage(() => {
    sessionStorage.setItem("playstop.attempt", "{not json");
    assert.equal(readAttempt(), null);
    assert.equal(sessionStorage.getItem("playstop.attempt"), null);
  });
});

test("a value that parses but does not match the attempt shape returns null and clears the key", () => {
  withStubStorage(() => {
    sessionStorage.setItem("playstop.attempt", JSON.stringify({ stationId: "station-1" }));
    assert.equal(readAttempt(), null);
    assert.equal(sessionStorage.getItem("playstop.attempt"), null);
  });
});

test("clearAttempt removes the key", () => {
  withStubStorage(() => {
    writeAttempt(sampleAttempt());
    clearAttempt();
    assert.equal(readAttempt(), null);
  });
});

// classifyReload is the four-case reload table from milestone-3-spec.md
// section 5. It arrived untested (the agent writing it was cut off), and it
// is the logic that decides whether a returning tab resumes a live hold or
// silently starts a second one, so it gets covered before it gets used.
const ROUTE = { stationId: "station-1", startsAt: "2026-08-28T20:30:00.000Z", slotCount: 4 };
const NOW = Date.parse("2026-08-28T20:30:00.000Z");

/** sampleAttempt (above) defaults to hold: null; this adds a live one. */
function heldAttempt(overrides: Partial<BookingAttempt> = {}, expiresAtMs = NOW + 120_000): BookingAttempt {
  return sampleAttempt({
    hold: {
      holdId: "22222222-2222-4222-8222-222222222222",
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttlSeconds: 300,
      quoteMinor: 30_000,
      currency: "INR",
    },
    ...overrides,
  });
}

test("classifyReload resumes a matching attempt whose hold is still live", () => {
  assert.equal(classifyReload(heldAttempt(), ROUTE, NOW).kind, "resume");
});

test("classifyReload treats a matching attempt with a past hold as expired", () => {
  assert.equal(classifyReload(heldAttempt({}, NOW - 1), ROUTE, NOW).kind, "expired");
});

test("classifyReload counts expiry exactly at now as expired, matching countdownState", () => {
  // countdownState uses Math.max(0, expiresAt - nowMs) === 0, so the two must
  // agree on the boundary, or the screen shows 0:00 while still believing it
  // holds the slot.
  assert.equal(classifyReload(heldAttempt({}, NOW), ROUTE, NOW).kind, "expired");
});

test("classifyReload routes a hold-less attempt to the degraded path", () => {
  assert.equal(classifyReload(sampleAttempt(), ROUTE, NOW).kind, "degraded");
});

test("classifyReload prompts rather than resumes when nothing is stored", () => {
  assert.equal(classifyReload(null, ROUTE, NOW).kind, "resume-prompt");
});

test("classifyReload prompts when the stored attempt is for a different request", () => {
  // Each field on its own must break the match: resuming another range's hold
  // would run a countdown for a slot this route is not booking.
  assert.equal(classifyReload(heldAttempt({ stationId: "station-2" }), ROUTE, NOW).kind, "resume-prompt");
  assert.equal(
    classifyReload(heldAttempt({ startsAt: "2026-08-28T21:00:00.000Z" }), ROUTE, NOW).kind,
    "resume-prompt",
  );
  assert.equal(classifyReload(heldAttempt({ slotCount: 2 }), ROUTE, NOW).kind, "resume-prompt");
});

test("readAttempt rejects a stored hold that is missing expiresAt", () => {
  // sessionStorage is user-editable. Without the per-field check this record
  // classified as "resume" and ran a countdown against Date.parse(undefined).
  withStubStorage(() => {
    sessionStorage.setItem(
      "playstop.attempt",
      JSON.stringify({
        ...sampleAttempt(),
        hold: { holdId: "x", ttlSeconds: 300, quoteMinor: 1, currency: "INR" },
      }),
    );
    assert.equal(readAttempt(), null);
    assert.equal(sessionStorage.getItem("playstop.attempt"), null, "the corrupt record is deleted, not left to rot");
  });
});
