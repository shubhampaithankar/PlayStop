import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClaimCells,
  generateSlotGrid,
  SlotNotOnGridError,
  SlotOutOfWindowError,
  type VenueSchedule,
} from "./grid.js";

function allWeek(open: string, close: string) {
  return {
    "0": { open, close },
    "1": { open, close },
    "2": { open, close },
    "3": { open, close },
    "4": { open, close },
    "5": { open, close },
    "6": { open, close },
  } as const;
}

test("contiguous play cells, no buffer", () => {
  const venue: VenueSchedule = {
    timezone: "Asia/Kolkata",
    gridMinutes: 30,
    bufferMinutes: 0,
    openingHours: allWeek("10:00", "18:00"),
    blackoutDates: [],
  };
  const result = generateSlotGrid(venue, "2026-08-10");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  const { playMs, bufferMs } = buildClaimCells(result.cells, result.cells[0]!.cellStartMs, 3, 0);
  assert.deepEqual(playMs, result.cells.slice(0, 3).map((c) => c.cellStartMs));
  assert.deepEqual(bufferMs, []);
});

test("buffer cells follow the play run", () => {
  const venue: VenueSchedule = {
    timezone: "Asia/Kolkata",
    gridMinutes: 30,
    bufferMinutes: 30,
    openingHours: allWeek("10:00", "18:00"),
    blackoutDates: [],
  };
  const result = generateSlotGrid(venue, "2026-08-10");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  const { playMs, bufferMs } = buildClaimCells(result.cells, result.cells[0]!.cellStartMs, 2, 1);
  assert.deepEqual(playMs, result.cells.slice(0, 2).map((c) => c.cellStartMs));
  assert.deepEqual(bufferMs, result.cells.slice(2, 3).map((c) => c.cellStartMs));
});

test("buffer run truncates at the end of the grid rather than extending past it", () => {
  const venue: VenueSchedule = {
    timezone: "Asia/Kolkata",
    gridMinutes: 30,
    bufferMinutes: 60,
    openingHours: allWeek("10:00", "18:00"),
    blackoutDates: [],
  };
  const result = generateSlotGrid(venue, "2026-08-10");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  const lastIndex = result.cells.length - 1;
  const { playMs, bufferMs } = buildClaimCells(result.cells, result.cells[lastIndex]!.cellStartMs, 1, 2);
  assert.equal(playMs.length, 1);
  assert.deepEqual(bufferMs, []); // nothing follows the last cell, so no buffer is written
});

test("a startsAtMs not on the grid raises SlotNotOnGridError", () => {
  const venue: VenueSchedule = {
    timezone: "Asia/Kolkata",
    gridMinutes: 30,
    bufferMinutes: 0,
    openingHours: allWeek("10:00", "18:00"),
    blackoutDates: [],
  };
  const result = generateSlotGrid(venue, "2026-08-10");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.throws(
    () => buildClaimCells(result.cells, result.cells[0]!.cellStartMs + 1, 1, 0),
    SlotNotOnGridError,
  );
});

test("a play run extending past closing raises SlotOutOfWindowError", () => {
  const venue: VenueSchedule = {
    timezone: "Asia/Kolkata",
    gridMinutes: 30,
    bufferMinutes: 0,
    openingHours: allWeek("10:00", "18:00"),
    blackoutDates: [],
  };
  const result = generateSlotGrid(venue, "2026-08-10");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  const lastIndex = result.cells.length - 1;
  assert.throws(
    () => buildClaimCells(result.cells, result.cells[lastIndex]!.cellStartMs, 2, 0),
    SlotOutOfWindowError,
  );
});

test("a booking spanning a fall-back transition occupies both duplicated local cells", () => {
  // 4 cells starting at the first (EDT) 01:00 occupy: 01:00 EDT, 01:30 EDT,
  // 01:00 EST, 01:30 EST -- 2 elapsed hours even though the local clock
  // only advances 1 hour.
  const venue: VenueSchedule = {
    timezone: "America/New_York",
    gridMinutes: 30,
    bufferMinutes: 0,
    openingHours: allWeek("00:00", "06:00"),
    blackoutDates: [],
  };
  const result = generateSlotGrid(venue, "2026-11-01");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  const firstAt0100Index = result.cells.findIndex((c) => c.localLabel.includes("01:00 EDT"));
  assert.notEqual(firstAt0100Index, -1);
  const { playMs } = buildClaimCells(result.cells, result.cells[firstAt0100Index]!.cellStartMs, 4, 0);
  assert.equal(playMs.length, 4);
  const startMs = playMs[0]!;
  const endMs = playMs[3]! + 1_800_000; // end of the last cell
  assert.equal(endMs - startMs, 2 * 3_600_000);
});
