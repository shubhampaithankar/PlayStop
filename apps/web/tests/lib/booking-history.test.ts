import { test } from "node:test";
import assert from "node:assert/strict";
import { readBookings, saveBooking, type SavedBooking } from "../../src/lib/booking-history.js";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function withStubStorage(stub: unknown, run: (stub: MemoryStorage) => void): void {
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true });
  try {
    run(stub as MemoryStorage);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
  }
}

function sample(id: string, savedAtMs: number): SavedBooking {
  return { id, code: "ABC123", stationName: "PS5 1", kind: "ps5", startsAtMs: 1, endsAtMs: 2, savedAtMs };
}

test("save dedupes by id, newest first, capped at 20", () => {
  withStubStorage(new MemoryStorage(), () => {
    saveBooking(sample("a", 1));
    saveBooking(sample("b", 2));
    saveBooking(sample("a", 3));
    assert.deepEqual(readBookings().map((entry) => entry.id), ["a", "b"]);
    for (let index = 0; index < 25; index++) saveBooking(sample(`n${index}`, 10 + index));
    assert.equal(readBookings().length, 20);
  });
});

test("junk in storage degrades to empty or drops bad entries", () => {
  const stub = new MemoryStorage();
  withStubStorage(stub, () => {
    stub.setItem("playstop.bookings", "not json");
    assert.deepEqual(readBookings(), []);
    stub.setItem("playstop.bookings", JSON.stringify([{ id: 1 }, sample("ok", 5)]));
    assert.deepEqual(readBookings().map((entry) => entry.id), ["ok"]);
  });
});

test("throwing storage never throws out", () => {
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  withStubStorage(throwing, () => {
    assert.deepEqual(readBookings(), []);
    assert.doesNotThrow(() => saveBooking(sample("a", 1)));
  });
});
