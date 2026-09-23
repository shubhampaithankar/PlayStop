import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvailabilityCell, StationSummary } from "@playstop/engine";
import {
  hourlyRateRupees,
  instantLabel,
  leadBlockedCells,
  lengthOptionsForStart,
  nonStartableWord,
  pickStationForKind,
  startCellState,
  startTimeCells,
  stationStatus,
  timeCellRows,
  timeLabelOf,
} from "../../src/lib/stations.js";

const STATION_ID = "station-1";

function cell(state: AvailabilityCell["state"], startsAt: string, endsAt: string): AvailabilityCell {
  return {
    stationId: STATION_ID,
    startsAt,
    endsAt,
    localLabel: `2026-08-28 ${startsAt.slice(11, 16)} EDT`,
    state,
  };
}

function station(overrides: Partial<StationSummary> = {}): StationSummary {
  return {
    id: STATION_ID,
    slug: "ps5-1",
    name: "PS5-1",
    kind: "ps5",
    capacity: 4,
    hourlyRateMinor: 15_000,
    minSlots: 2,
    maxSlots: 8,
    ...overrides,
  };
}

// Half-hour cells starting at 20:00 UTC: 20:00, 20:30, 21:00, 21:30, 22:00.
const T = ["20:00", "20:30", "21:00", "21:30", "22:00", "22:30"];
const startsAt = (i: number) => `2026-08-28T${T[i]}:00.000Z`;
const endsAt = (i: number) => `2026-08-28T${T[i + 1]}:00.000Z`;

test("hourlyRateRupees divides the paise rate by 100", () => {
  assert.equal(hourlyRateRupees(station({ hourlyRateMinor: 15_000 })), 150);
});

test("timeLabelOf converts 24h localLabel times to DESIGN.md's 12h format", () => {
  const at = (hhmm: string) => timeLabelOf(cell("free", `2026-08-28T${hhmm}:00.000Z`, `2026-08-28T${hhmm}:00.000Z`));
  assert.equal(at("00:00"), "12:00 am");
  assert.equal(at("12:00"), "12:00 pm");
  assert.equal(at("08:30"), "8:30 am");
  assert.equal(at("20:30"), "8:30 pm");
});

test("free_now: the first non-past cell begins a long-enough free run", () => {
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    cell("free", startsAt(1), endsAt(1)),
    cell("booked", startsAt(2), endsAt(2)),
  ];
  assert.deepEqual(stationStatus(cells, station({ minSlots: 2 })), { kind: "free_now" });
});

test("free_from: the first cell is not bookable, a later run is", () => {
  const cells = [
    cell("booked", startsAt(0), endsAt(0)),
    cell("booked", startsAt(1), endsAt(1)),
    cell("free", startsAt(2), endsAt(2)),
    cell("free", startsAt(3), endsAt(3)),
  ];
  const result = stationStatus(cells, station({ minSlots: 2 }));
  assert.deepEqual(result, { kind: "free_from", timeLabel: timeLabelOf(cells[2]!) });
});

test("maintenance: the first non-past cell is maintenance and nothing else is bookable", () => {
  const cells = [
    cell("maintenance", startsAt(0), endsAt(0)),
    cell("maintenance", startsAt(1), endsAt(1)),
  ];
  assert.deepEqual(stationStatus(cells, station({ minSlots: 2 })), { kind: "maintenance" });
});

test("booked_out: no bookable run and the first cell is not maintenance", () => {
  const cells = [cell("booked", startsAt(0), endsAt(0)), cell("held", startsAt(1), endsAt(1))];
  assert.deepEqual(stationStatus(cells, station({ minSlots: 2 })), { kind: "booked_out" });
});

test("minSlots is respected: 3 free cells is not enough for a minSlots-4 station", () => {
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    cell("free", startsAt(1), endsAt(1)),
    cell("free", startsAt(2), endsAt(2)),
    cell("booked", startsAt(3), endsAt(3)),
  ];
  assert.deepEqual(stationStatus(cells, station({ minSlots: 4 })), { kind: "booked_out" });
});

test("a gap where endsAt !== next startsAt breaks adjacency, even though both cells are free", () => {
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    // Deliberately not adjacent to the previous cell's endsAt.
    cell("free", "2026-08-28T21:15:00.000Z", "2026-08-28T21:45:00.000Z"),
  ];
  assert.deepEqual(stationStatus(cells, station({ minSlots: 2 })), { kind: "booked_out" });
});

test("startTimeCells: a run shorter than minSlots is not startable", () => {
  // Index 0's run is 1 (booked right after it) -- too short for minSlots 2.
  // Index 2's run of 2 (with index 3) is what keeps the list non-empty.
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    cell("booked", startsAt(1), endsAt(1)),
    cell("free", startsAt(2), endsAt(2)),
    cell("free", startsAt(3), endsAt(3)),
  ];
  const result = startTimeCells(cells, 2);
  assert.deepEqual(
    result.map((c) => c.startable),
    [false, false, true],
  );
});

test("startTimeCells: nothing after the last startable cell is included", () => {
  // free, free, free with minSlots 2: index 0 (run of 3) and index 1 (run
  // of 2) can start a booking; index 2 (run of 1) cannot and is dropped
  // entirely, not shown as taken.
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    cell("free", startsAt(1), endsAt(1)),
    cell("free", startsAt(2), endsAt(2)),
  ];
  const result = startTimeCells(cells, 2);
  assert.deepEqual(
    result.map((c) => c.cell.startsAt),
    [startsAt(0), startsAt(1)],
  );
  assert.deepEqual(
    result.map((c) => c.startable),
    [true, true],
  );
});

test("startTimeCells: a taken cell before the last startable one still appears, flagged not startable", () => {
  const cells = [
    cell("booked", startsAt(0), endsAt(0)),
    cell("free", startsAt(1), endsAt(1)),
    cell("free", startsAt(2), endsAt(2)),
  ];
  const result = startTimeCells(cells, 2);
  assert.deepEqual(
    result.map((c) => c.startable),
    [false, true],
  );
});

test("startTimeCells: an adjacency gap breaks the run -- the cell before the gap is not startable, the one after is", () => {
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    // Deliberately not adjacent to the previous cell's endsAt.
    cell("free", "2026-08-28T21:15:00.000Z", "2026-08-28T21:45:00.000Z"),
    cell("free", "2026-08-28T21:45:00.000Z", "2026-08-28T22:15:00.000Z"),
  ];
  // Index 0's run stops at the gap (length 1, not startable). Index 1's run
  // continues into the adjacent index 2 (length 2, startable) -- that is
  // also the last startable index, so index 2 (a lone cell, run of 1) is
  // dropped entirely rather than shown as taken.
  const result = startTimeCells(cells, 2);
  assert.deepEqual(
    result.map((c) => c.cell.startsAt),
    [cells[0]?.startsAt, cells[1]?.startsAt],
  );
  assert.deepEqual(
    result.map((c) => c.startable),
    [false, true],
  );
});

test("startTimeCells: an adjacency gap with nothing bookable on either side returns empty", () => {
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    // Deliberately not adjacent to the previous cell's endsAt, and alone.
    cell("free", "2026-08-28T21:15:00.000Z", "2026-08-28T21:45:00.000Z"),
  ];
  assert.deepEqual(startTimeCells(cells, 2), []);
});

test("startTimeCells: past cells are excluded entirely", () => {
  const cells = [
    cell("past", startsAt(0), endsAt(0)),
    cell("free", startsAt(1), endsAt(1)),
    cell("free", startsAt(2), endsAt(2)),
    cell("free", startsAt(3), endsAt(3)),
  ];
  const result = startTimeCells(cells, 2);
  // index 0 (past) is gone; index 3's run of 1 is beyond the last startable
  // cell (index 2) so it is dropped too -- only index 1 and 2 remain.
  assert.deepEqual(
    result.map((c) => c.cell.startsAt),
    [startsAt(1), startsAt(2)],
  );
  assert.deepEqual(
    result.map((c) => c.startable),
    [true, true],
  );
});

test("startTimeCells: no cell can start a bookable run returns an empty list", () => {
  const cells = [cell("booked", startsAt(0), endsAt(0)), cell("held", startsAt(1), endsAt(1))];
  assert.deepEqual(startTimeCells(cells, 2), []);
});

test("nonStartableWord: a maintenance cell reports 'being fixed' rather than 'taken'", () => {
  assert.equal(nonStartableWord(cell("maintenance", startsAt(0), endsAt(0))), "being fixed");
  assert.equal(nonStartableWord(cell("booked", startsAt(0), endsAt(0))), "taken");
  assert.equal(nonStartableWord(cell("held", startsAt(0), endsAt(0))), "taken");
});

// Half-hour grid: 1 hour = 2 slots, 2 hours = 4 slots, 3 hours = 6 slots.
const GRID_MINUTES = 30;

test("lengthOptionsForStart: a length that fits is offered and available", () => {
  const cells = [cell("free", startsAt(0), endsAt(0)), cell("free", startsAt(1), endsAt(1))];
  const options = lengthOptionsForStart(cells, startsAt(0), station({ hourlyRateMinor: 15_000 }), GRID_MINUTES);
  const oneHour = options.find((o) => o.hours === 1);
  assert.equal(oneHour?.available, true);
  assert.equal(oneHour?.slotCount, 2);
  assert.equal(oneHour?.priceRupees, 150);
  assert.equal(oneHour?.blockedFromLabel, undefined);
});

test("lengthOptionsForStart: a length blocked mid-range reports the correct blocking time", () => {
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    cell("free", startsAt(1), endsAt(1)),
    cell("free", startsAt(2), endsAt(2)),
    cell("booked", startsAt(3), endsAt(3)),
    cell("free", startsAt(4), endsAt(4)),
  ];
  const options = lengthOptionsForStart(cells, startsAt(0), station(), GRID_MINUTES);
  const twoHours = options.find((o) => o.hours === 2);
  assert.equal(twoHours?.available, false);
  assert.equal(twoHours?.blockedFromLabel, timeLabelOf(cells[3]!));
});

test("lengthOptionsForStart: maxSlots caps the offered lengths", () => {
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    cell("free", startsAt(1), endsAt(1)),
    cell("free", startsAt(2), endsAt(2)),
    cell("free", startsAt(3), endsAt(3)),
  ];
  const options = lengthOptionsForStart(cells, startsAt(0), station({ maxSlots: 2 }), GRID_MINUTES);
  assert.deepEqual(
    options.map((o) => o.hours),
    [1],
  );
});

test("lengthOptionsForStart: an adjacency gap blocks a length that would otherwise fit", () => {
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    // Deliberately not adjacent to the previous cell's endsAt.
    cell("free", "2026-08-28T21:15:00.000Z", "2026-08-28T21:45:00.000Z"),
  ];
  const options = lengthOptionsForStart(cells, startsAt(0), station(), GRID_MINUTES);
  const oneHour = options.find((o) => o.hours === 1);
  assert.equal(oneHour?.available, false);
});

test("lengthOptionsForStart: a start with only 1 free hour offers 1 hour but not 2", () => {
  const cells = [
    cell("free", startsAt(0), endsAt(0)),
    cell("free", startsAt(1), endsAt(1)),
    cell("booked", startsAt(2), endsAt(2)),
  ];
  const options = lengthOptionsForStart(cells, startsAt(0), station(), GRID_MINUTES);
  assert.equal(options.find((o) => o.hours === 1)?.available, true);
  assert.equal(options.find((o) => o.hours === 2)?.available, false);
});

// Regression: a start whose own cell is not free used to yield a full set
// of unavailable options whose "blocking" cell was the start itself, which
// rendered as "taken from 3:00 pm" against a 3:00 pm start. No options at
// all is the honest answer; the screen reads startCellState for the reason.
test("a start whose own cell is not free offers no lengths at all", () => {
  for (const state of ["past", "booked", "held", "maintenance"] as const) {
    const cells = [
      cell(state, startsAt(0), endsAt(0)),
      cell("free", startsAt(1), endsAt(1)),
      cell("free", startsAt(2), endsAt(2)),
      cell("free", startsAt(3), endsAt(3)),
    ];
    assert.deepEqual(lengthOptionsForStart(cells, startsAt(0), station(), GRID_MINUTES), [], state);
  }
});

test("startCellState reports the state of the cell a start points at", () => {
  const cells = [cell("past", startsAt(0), endsAt(0)), cell("free", startsAt(1), endsAt(1))];
  assert.equal(startCellState(cells, startsAt(0)), "past");
  assert.equal(startCellState(cells, startsAt(1)), "free");
  assert.equal(startCellState(cells, startsAt(9)), undefined);
});

test("instantLabel formats an ISO instant in the given timezone, matching timeLabelOf's format", () => {
  assert.equal(instantLabel("2026-08-28T20:30:00.000Z", "America/New_York"), "4:30 pm");
  assert.equal(instantLabel("2026-08-28T00:00:00.000Z", "UTC"), "12:00 am");
});

// Lead time (booking-guardrails-otp-design.md frontend phase):
// computeAvailability (packages/engine) marks a cell CELL_STATES.PAST both
// when it has already begun and when it starts within venue.leadTimeMinutes
// -- the client tells the two apart by its own clock.
test("leadBlockedCells: a cell starting exactly at the lead boundary is not blocked", () => {
  const nowMs = Date.parse("2026-08-28T20:00:00.000Z");
  const cells = [
    // Starts exactly 30 minutes from now: the server would not have marked
    // this PAST for lead time (the guard is strictly "<"), so it is FREE.
    cell("free", "2026-08-28T20:30:00.000Z", "2026-08-28T21:00:00.000Z"),
  ];
  assert.deepEqual(leadBlockedCells(cells, nowMs), []);
});

test("leadBlockedCells: a cell starting 29 minutes out (inside a 30-minute lead) is blocked", () => {
  const nowMs = Date.parse("2026-08-28T20:00:00.000Z");
  const cells = [
    // Starts 29 minutes from now: too soon, so the server marks it PAST --
    // but it has not actually begun yet, so leadBlockedCells surfaces it.
    cell("past", "2026-08-28T20:29:00.000Z", "2026-08-28T20:59:00.000Z"),
  ];
  const blocked = leadBlockedCells(cells, nowMs);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0]?.startsAt, "2026-08-28T20:29:00.000Z");
});

test("leadBlockedCells: a cell that has genuinely already started is not returned", () => {
  const nowMs = Date.parse("2026-08-28T20:00:00.000Z");
  const cells = [cell("past", "2026-08-28T19:30:00.000Z", "2026-08-28T20:00:00.000Z")];
  assert.deepEqual(leadBlockedCells(cells, nowMs), []);
});

test("timeCellRows: too-soon rows sort before the real startable/taken rows", () => {
  const nowMs = Date.parse("2026-08-28T19:59:00.000Z");
  const cells = [
    cell("past", "2026-08-28T20:00:00.000Z", "2026-08-28T20:30:00.000Z"), // too soon (1 min out)
    cell("free", "2026-08-28T20:30:00.000Z", "2026-08-28T21:00:00.000Z"),
    cell("free", "2026-08-28T21:00:00.000Z", "2026-08-28T21:30:00.000Z"),
  ];
  const rows = timeCellRows(cells, 1, nowMs);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["too-soon", "cell", "cell"],
  );
  assert.deepEqual(
    rows.map((r) => r.cell.startsAt),
    ["2026-08-28T20:00:00.000Z", "2026-08-28T20:30:00.000Z", "2026-08-28T21:00:00.000Z"],
  );
});

// Sibling fallback (booking-guardrails-otp-design.md frontend phase):
// pickStationForKind, re-run against fresh availability for the same kind,
// is what the client falls back to on SLOT_TAKEN.
test("sibling re-pick: the taken unit's kind falls to the next free sibling", () => {
  const taken = station({ id: "ps5-1", name: "PS5 #1" });
  const free = station({ id: "ps5-2", name: "PS5 #2" });
  const takenCells: AvailabilityCell[] = [{ ...cell("booked", startsAt(0), endsAt(0)), stationId: taken.id }];
  const freeCells: AvailabilityCell[] = [
    { ...cell("free", startsAt(0), endsAt(0)), stationId: free.id },
    { ...cell("free", startsAt(1), endsAt(1)), stationId: free.id },
  ];
  const target = pickStationForKind([taken, free], [...takenCells, ...freeCells]);
  assert.equal(target?.id, free.id);
});

test("sibling re-pick: no free sibling of the kind bounces (undefined)", () => {
  const first = station({ id: "ps5-1", name: "PS5 #1" });
  const second = station({ id: "ps5-2", name: "PS5 #2" });
  const cells: AvailabilityCell[] = [
    { ...cell("booked", startsAt(0), endsAt(0)), stationId: first.id },
    { ...cell("held", startsAt(0), endsAt(0)), stationId: second.id },
  ];
  assert.equal(pickStationForKind([first, second], cells), undefined);
});
