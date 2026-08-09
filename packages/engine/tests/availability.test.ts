import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAvailability, type AvailabilityInput, type StationInput, type VenueSchedule } from "@playstop/engine";

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

function baseVenue(): VenueSchedule & { leadTimeMinutes: number; maxAdvanceDays: number } {
  return {
    timezone: "Asia/Kolkata",
    gridMinutes: 30,
    bufferMinutes: 0,
    openingHours: allWeek("10:00", "18:00"),
    blackoutDates: [],
    leadTimeMinutes: 0,
    maxAdvanceDays: 365,
  };
}

function station(overrides: Partial<StationInput> = {}): StationInput {
  return {
    stationId: "station-1",
    slug: "ps5-1",
    name: "PS5 #1",
    kind: "ps5",
    capacity: 4,
    hourlyRateMinor: 15000,
    minSlots: 1,
    maxSlots: 8,
    maintenanceWindows: [],
    ...overrides,
  };
}

const DEFAULT_NOW_MS = Date.parse("2026-01-01T00:00:00.000Z");

function baseInput(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    venue: baseVenue(),
    businessDate: "2026-08-10",
    stations: [station()],
    claims: [],
    holds: [],
    nowMs: DEFAULT_NOW_MS,
    ...overrides,
  };
}

// case 14
test("lead time: cells before now + leadTimeMinutes are past, the one right after is not", () => {
  const venue = { ...baseVenue(), leadTimeMinutes: 60 };
  // Session opens 10:00 IST = 04:30Z. Pick "now" mid-session, at the instant
  // of the 6th cell's start (13:00 IST).
  const nowMs = Date.parse("2026-08-10T07:30:00.000Z"); // 13:00 IST
  const result = computeAvailability(baseInput({ venue, nowMs }));
  assert.equal(result.closed, null);
  const byStart = new Map(result.cells.map((c) => [c.startsAt, c]));
  const cutoffMs = nowMs + 60 * 60_000; // 14:30 IST
  const beforeCutoff = new Date(cutoffMs - 1_800_000).toISOString();
  const atOrAfterCutoff = new Date(cutoffMs).toISOString();
  assert.equal(byStart.get(beforeCutoff)?.state, "past");
  assert.notEqual(byStart.get(atOrAfterCutoff)?.state, "past");
});

// case 15
test("max advance: a date beyond maxAdvanceDays returns every cell as too_far_ahead", () => {
  const venue = { ...baseVenue(), leadTimeMinutes: 0, maxAdvanceDays: 1 };
  const nowMs = Date.parse("2026-08-01T00:00:00.000Z");
  const result = computeAvailability(baseInput({ venue, businessDate: "2026-08-10", nowMs }));
  assert.equal(result.closed, null);
  assert.ok(result.cells.length > 0);
  for (const cell of result.cells) {
    assert.equal(cell.state, "too_far_ahead");
  }
});

// case 16
test("maintenance window marks overlapping cells only, half-open boundaries excluded", () => {
  const venue = baseVenue();
  // Session opens 10:00 IST = 04:30Z. Cells: 04:30-05:00, 05:00-05:30, 05:30-06:00, ...
  const cellStart = Date.parse("2026-08-10T05:00:00.000Z");
  const cellEnd = cellStart + 1_800_000;
  const stationWithMaintenance = station({
    maintenanceWindows: [{ startsAtMs: cellStart, endsAtMs: cellEnd }],
  });
  const result = computeAvailability(baseInput({ venue, stations: [stationWithMaintenance] }));
  const byStart = new Map(result.cells.map((c) => [Date.parse(c.startsAt), c]));
  assert.equal(byStart.get(cellStart)?.state, "maintenance");
  // window ending exactly at this cell's start does NOT mark the previous cell
  assert.notEqual(byStart.get(cellStart - 1_800_000)?.state, "maintenance");
  // window starting exactly at this cell's end does NOT mark the next cell
  assert.notEqual(byStart.get(cellEnd)?.state, "maintenance");
});

// case 17
test("maintenance window spanning a DST transition covers the correct number of real cells", () => {
  const venue: VenueSchedule & { leadTimeMinutes: number; maxAdvanceDays: number } = {
    timezone: "America/New_York",
    gridMinutes: 30,
    bufferMinutes: 0,
    openingHours: allWeek("00:00", "06:00"),
    blackoutDates: [],
    leadTimeMinutes: 0,
    maxAdvanceDays: 365,
  };
  // Spring-forward night: 2026-03-08 00:00-06:00 gives 10 cells (case 4).
  // A maintenance window covering the whole session should mark all 10.
  const openMs = Date.parse("2026-03-08T05:00:00.000Z"); // 00:00 EST
  const closeMs = Date.parse("2026-03-08T10:00:00.000Z"); // 06:00 EDT
  const stationWithMaintenance = station({
    maintenanceWindows: [{ startsAtMs: openMs, endsAtMs: closeMs }],
  });
  const result = computeAvailability(
    baseInput({ venue, businessDate: "2026-03-08", stations: [stationWithMaintenance] }),
  );
  assert.equal(result.cells.length, 10);
  for (const cell of result.cells) {
    assert.equal(cell.state, "maintenance");
  }
});

// case 18
test("state precedence: a cell both booked and held is reported as booked", () => {
  const cellStart = Date.parse("2026-08-10T04:30:00.000Z"); // first cell
  const result = computeAvailability(
    baseInput({
      claims: [{ stationId: "station-1", cellStartMs: cellStart }],
      holds: [{ stationId: "station-1", cellStartMs: cellStart }],
    }),
  );
  const first = result.cells.find((c) => Date.parse(c.startsAt) === cellStart);
  assert.equal(first?.state, "booked");
});

// case 19
test("empty station list gives empty cells and closed === null", () => {
  const result = computeAvailability(baseInput({ stations: [] }));
  assert.equal(result.closed, null);
  assert.deepEqual(result.cells, []);
});

// case 21
test("determinism: identical input returns deeply equal output", () => {
  const input = baseInput({ nowMs: Date.parse("2026-08-10T06:00:00.000Z") });
  const first = computeAvailability(input);
  const second = computeAvailability(input);
  assert.deepEqual(first, second);
});