import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  generateSlotGrid,
  InvalidOpeningHoursError,
  InvalidGridMinutesError,
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

function baseVenue(overrides: Partial<VenueSchedule> = {}): VenueSchedule {
  return {
    timezone: "Asia/Kolkata",
    gridMinutes: 30,
    bufferMinutes: 0,
    openingHours: allWeek("10:00", "18:00"),
    blackoutDates: [],
    ...overrides,
  };
}

function assertWindowBounds(result: {
  kind: string;
  windowStartMs: number;
  windowEndMs: number;
  cells?: readonly { cellStartMs: number; cellEndMs: number }[];
}): void {
  assert.ok(result.windowEndMs - result.windowStartMs <= 86_400_000);
  if (result.kind === "open" && result.cells) {
    assert.equal(result.cells[0]?.cellStartMs, result.windowStartMs);
    const last = result.cells[result.cells.length - 1];
    assert.ok(last && result.windowEndMs >= last.cellEndMs);
  }
}

// case 1
test("normal session yields 16 cells, first 10:00, last ends exactly at 18:00", () => {
  const result = generateSlotGrid(baseVenue(), "2026-08-10");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.equal(result.cells.length, 16);
  assert.match(result.cells[0]!.localLabel, /^2026-08-10 10:00/);
  assert.equal(result.cells[result.cells.length - 1]!.cellEndMs, result.windowEndMs);
  assertWindowBounds(result);
});

// case 2
test("trailing partial cell is dropped", () => {
  const venue = baseVenue({ openingHours: allWeek("10:00", "10:50") });
  const result = generateSlotGrid(venue, "2026-08-10");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.equal(result.cells.length, 1);
});

// case 3
test("gridMinutes that does not divide 60 is rejected", () => {
  const venue = baseVenue({ gridMinutes: 40 });
  assert.throws(() => generateSlotGrid(venue, "2026-08-10"), InvalidGridMinutesError);
});

// case 4
test("spring forward interior drops exactly 2 cells and skips the 02: hour", () => {
  const venue = baseVenue({
    timezone: "America/New_York",
    openingHours: allWeek("00:00", "06:00"),
  });
  const result = generateSlotGrid(venue, "2026-03-08");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.equal(result.cells.length, 10);
  for (const cell of result.cells) {
    assert.doesNotMatch(cell.localLabel, /02:/);
  }
  for (let i = 1; i < result.cells.length; i++) {
    assert.equal(result.cells[i]!.cellStartMs - result.cells[i - 1]!.cellStartMs, 1_800_000);
  }
});

// case 5
test("spring forward opening boundary advances to 03:30", () => {
  const venue = baseVenue({
    timezone: "America/New_York",
    openingHours: allWeek("02:30", "06:00"),
  });
  const result = generateSlotGrid(venue, "2026-03-08");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.match(result.cells[0]!.localLabel, /^2026-03-08 03:30/);
});

// case 6
test("fall back interior yields 14 cells with both 01:00 and both 01:30 occurrences", () => {
  const venue = baseVenue({
    timezone: "America/New_York",
    openingHours: allWeek("00:00", "06:00"),
  });
  const result = generateSlotGrid(venue, "2026-11-01");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.equal(result.cells.length, 14);
  const at0100 = result.cells.filter((c) => c.localLabel.includes("01:00"));
  const at0130 = result.cells.filter((c) => c.localLabel.includes("01:30"));
  assert.equal(at0100.length, 2);
  assert.equal(at0130.length, 2);
  assert.equal(at0100[1]!.cellStartMs - at0100[0]!.cellStartMs, 3_600_000);
  assert.notEqual(at0100[0]!.localLabel, at0100[1]!.localLabel);
  assert.match(at0100[0]!.localLabel, /EDT/);
  assert.match(at0100[1]!.localLabel, /EST/);
});

// case 7
test("fall back closing boundary takes the later (EST) candidate", () => {
  const venue = baseVenue({
    timezone: "America/New_York",
    openingHours: allWeek("00:00", "01:30"),
  });
  const result = generateSlotGrid(venue, "2026-11-01");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  const last = result.cells[result.cells.length - 1]!;
  assert.match(last.localLabel, /01:00 EST$/);
  assert.equal(last.cellEndMs, result.windowEndMs);
});

// case 8
test("southern hemisphere: Sydney spring forward (October) interior drops cells", () => {
  const venue = baseVenue({
    timezone: "Australia/Sydney",
    openingHours: allWeek("00:00", "06:00"),
  });
  const result = generateSlotGrid(venue, "2026-10-04");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.equal(result.cells.length, 10);
});

test("southern hemisphere: Sydney fall back (April) interior adds cells", () => {
  const venue = baseVenue({
    timezone: "Australia/Sydney",
    openingHours: allWeek("00:00", "06:00"),
  });
  const result = generateSlotGrid(venue, "2026-04-05");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.equal(result.cells.length, 14);
});

// case 9
test("half-hour offset zone (Asia/Kolkata) lands cells on UTC :00 and :30", () => {
  const result = generateSlotGrid(baseVenue(), "2026-08-10");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  for (const cell of result.cells) {
    const minute = new Date(cell.cellStartMs).getUTCMinutes();
    assert.ok(minute === 0 || minute === 30, `expected :00 or :30, got :${minute}`);
    assert.match(cell.localLabel, /:(00|30) /);
  }
});

// case 10
test("zone with historical offset changes but no current DST (Asia/Shanghai)", () => {
  const venue = baseVenue({ timezone: "Asia/Shanghai", openingHours: allWeek("10:00", "18:00") });
  const result = generateSlotGrid(venue, "2026-08-10");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.equal(result.cells.length, 16);
  assert.equal(result.windowEndMs - result.windowStartMs, 8 * 3_600_000);
});

// case 11
test("weekday closed gives weekday_closed with zero cells and populated window", () => {
  const venue = baseVenue({ openingHours: { ...allWeek("10:00", "18:00"), "0": null } });
  const result = generateSlotGrid(venue, "2026-08-09"); // a Sunday
  assert.equal(result.kind, "closed");
  if (result.kind !== "closed") return;
  assert.equal(result.reason, "weekday_closed");
  assert.ok(result.windowEndMs > result.windowStartMs);
});

// case 12
test("blackout date gives blackout with zero cells", () => {
  const venue = baseVenue({ blackoutDates: ["2026-08-10"] });
  const result = generateSlotGrid(venue, "2026-08-10");
  assert.equal(result.kind, "closed");
  if (result.kind !== "closed") return;
  assert.equal(result.reason, "blackout");
});

// case 13
test("weekday index mapping: only the configured day opens, Sunday maps to '0'", () => {
  const venue = baseVenue({
    openingHours: { ...allWeek("10:00", "18:00"), "1": null, "2": null, "3": null, "4": null, "5": null, "6": null },
  });
  // 2026-08-09 is a Sunday; the week 08-03 (Mon) .. 08-09 (Sun).
  const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"];
  for (const date of dates) {
    const wd = DateTime.fromISO(date, { zone: venue.timezone }).weekday % 7;
    const result = generateSlotGrid(venue, date);
    if (wd === 0) {
      assert.equal(result.kind, "open", `${date} (Sunday) should be open`);
    } else {
      assert.equal(result.kind, "closed", `${date} should be closed`);
    }
  }
});

// case 20
test("a session that resolves to more than 24 hours throws InvalidOpeningHoursError", () => {
  // open == close ("14:00") rolls to next day (equal counts as close <= open),
  // and 2026-10-31 -> 2026-11-01 crosses the fall-back transition, so the
  // resolved session is 25 hours, not 24.
  const venue = baseVenue({
    timezone: "America/New_York",
    openingHours: allWeek("14:00", "14:00"),
  });
  assert.throws(() => generateSlotGrid(venue, "2026-10-31"), InvalidOpeningHoursError);
});

// case 22
test("midnight crossing, basic: 14:00-02:00 gives 24 cells spanning into the next day", () => {
  const venue = baseVenue({ openingHours: allWeek("14:00", "02:00") });
  const result = generateSlotGrid(venue, "2026-08-07");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.equal(result.cells.length, 24);
  assert.match(result.cells[0]!.localLabel, /^2026-08-07 14:00/);
  const last = result.cells[result.cells.length - 1]!;
  assert.match(last.localLabel, /^2026-08-08 01:30/);
  assert.equal(last.cellEndMs, result.windowEndMs);
  assertWindowBounds(result);
});

// case 23
test("midnight crossing, cell ownership: sessions for D and D+1 are disjoint", () => {
  const venue = baseVenue({ openingHours: allWeek("14:00", "02:00") });
  const friday = generateSlotGrid(venue, "2026-08-07");
  const saturday = generateSlotGrid(venue, "2026-08-08");
  assert.equal(friday.kind, "open");
  assert.equal(saturday.kind, "open");
  if (friday.kind !== "open" || saturday.kind !== "open") return;
  const fridayStarts = new Set(friday.cells.map((c) => c.cellStartMs));
  const saturdayStarts = new Set(saturday.cells.map((c) => c.cellStartMs));
  for (const ms of saturdayStarts) {
    assert.ok(!fridayStarts.has(ms));
  }
  // Friday's session does include the Saturday-morning 01:30 instant.
  const saturdayMorning0130 = saturday.cells[0]!.cellStartMs; // Saturday opens 14:00, unrelated instant
  assert.notEqual(saturdayMorning0130, undefined);
  const fridayTailInstant = friday.cells[friday.cells.length - 1]!.cellStartMs;
  assert.ok(fridayStarts.has(fridayTailInstant));
  assert.ok(!saturdayStarts.has(fridayTailInstant));
});

// case 24
test("midnight crossing, weekday lookup: Friday session emits Saturday cells even though Saturday is closed", () => {
  const venue = baseVenue({
    openingHours: { ...allWeek("14:00", "02:00"), "6": null }, // Saturday closed
  });
  const friday = generateSlotGrid(venue, "2026-08-07");
  assert.equal(friday.kind, "open");
  if (friday.kind === "open") {
    assert.equal(friday.cells.length, 24);
  }
  const saturday = generateSlotGrid(venue, "2026-08-08");
  assert.equal(saturday.kind, "closed");
  if (saturday.kind === "closed") {
    assert.equal(saturday.reason, "weekday_closed");
  }
});

// case 25
test("midnight crossing, blackout removes the whole session including the tail", () => {
  const venue = baseVenue({
    openingHours: allWeek("14:00", "02:00"),
    blackoutDates: ["2026-08-07"],
  });
  const result = generateSlotGrid(venue, "2026-08-07");
  assert.equal(result.kind, "closed");
  if (result.kind === "closed") {
    assert.equal(result.reason, "blackout");
  }
});

// case 26
// SPEC DISCREPANCY: the numbered case claims the transition night yields
// "two fewer cells than the neighboring nights". That contradicts the
// spec's own prose immediately above the edge-case list ("closeInstant
// lands exactly on the transition instant... needs no special case") and
// verified Luxon arithmetic: closing at 02:00 on a night that springs
// forward at 02:00 resolves to the SAME UTC instant a non-DST close would,
// so elapsed time (and cell count) is identical to a normal night, 24
// cells, not 22. This test asserts the mathematically correct value.
test("midnight crossing over spring forward, closing exactly at the transition", () => {
  const venue = baseVenue({
    timezone: "America/New_York",
    openingHours: allWeek("14:00", "02:00"),
  });
  const transitionNight = generateSlotGrid(venue, "2026-03-07");
  const neighborBefore = generateSlotGrid(venue, "2026-03-06");
  const neighborAfter = generateSlotGrid(venue, "2026-03-09");
  assert.equal(transitionNight.kind, "open");
  assert.equal(neighborBefore.kind, "open");
  assert.equal(neighborAfter.kind, "open");
  if (transitionNight.kind !== "open" || neighborBefore.kind !== "open" || neighborAfter.kind !== "open") {
    return;
  }
  // closeInstant equals the transition instant (2026-03-08T02:00 local,
  // resolved forward to 03:00 EDT, which is 2026-03-08T07:00:00.000Z).
  assert.equal(transitionNight.windowEndMs, Date.parse("2026-03-08T07:00:00.000Z"));
  assert.equal(transitionNight.cells.length, 24);
  assert.equal(transitionNight.cells.length, neighborBefore.cells.length);
  assert.equal(transitionNight.cells.length, neighborAfter.cells.length);
});

// case 27
test("midnight crossing over spring forward, closing after the transition is 1 hour shorter", () => {
  const venue = baseVenue({
    timezone: "America/New_York",
    openingHours: allWeek("14:00", "04:00"),
  });
  const transitionNight = generateSlotGrid(venue, "2026-03-07");
  const normalNight = generateSlotGrid(venue, "2026-03-06");
  assert.equal(transitionNight.kind, "open");
  assert.equal(normalNight.kind, "open");
  if (transitionNight.kind !== "open" || normalNight.kind !== "open") return;
  assert.equal(normalNight.cells.length - transitionNight.cells.length, 2); // 1 hour = 2 cells
  for (const cell of transitionNight.cells) {
    assert.doesNotMatch(cell.localLabel, /02:/);
  }
});

// case 28
test("midnight crossing over fall back yields 2 more cells with duplicated 01:00/01:30", () => {
  const venue = baseVenue({
    timezone: "America/New_York",
    openingHours: allWeek("14:00", "02:00"),
  });
  const transitionNight = generateSlotGrid(venue, "2026-10-31");
  const normalNight = generateSlotGrid(venue, "2026-10-30");
  assert.equal(transitionNight.kind, "open");
  assert.equal(normalNight.kind, "open");
  if (transitionNight.kind !== "open" || normalNight.kind !== "open") return;
  assert.equal(transitionNight.cells.length - normalNight.cells.length, 2);
  const at0100 = transitionNight.cells.filter((c) => c.localLabel.includes("01:00"));
  const at0130 = transitionNight.cells.filter((c) => c.localLabel.includes("01:30"));
  assert.equal(at0100.length, 2);
  assert.equal(at0130.length, 2);
  assert.notEqual(at0100[0]!.localLabel, at0100[1]!.localLabel);
});

// case 29
test("midnight crossing over fall back, closing inside the ambiguous hour takes both passes of 01:00", () => {
  const venue = baseVenue({
    timezone: "America/New_York",
    openingHours: allWeek("14:00", "01:30"),
  });
  const result = generateSlotGrid(venue, "2026-10-31");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  const at0100 = result.cells.filter((c) => c.localLabel.includes("01:00"));
  assert.equal(at0100.length, 2);
  const last = result.cells[result.cells.length - 1]!;
  assert.match(last.localLabel, /01:00 EST$/);
});

// case 30
test("calendar roll versus elapsed roll: the midnight roll preserves the local closing hour", () => {
  const venue = baseVenue({
    timezone: "America/New_York",
    openingHours: allWeek("14:00", "04:00"),
  });
  const result = generateSlotGrid(venue, "2026-03-07");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;

  // Correct (calendar-aware, plus({days: 1})): local 04:00 is preserved,
  // landing on 2026-03-08T04:00 in whatever offset applies that day.
  const calendarCorrect = DateTime.fromISO("2026-03-08T04:00", {
    zone: "America/New_York",
  }).toMillis();

  // Wrong (elapsed, plus({hours: 24})): adding a fixed 24 real hours to the
  // pre-roll local instant lands on wall-clock 05:00 that day, because
  // spring-forward silently ate an hour.
  const elapsedWrong =
    DateTime.fromISO("2026-03-07T04:00", { zone: "America/New_York" })
      .toMillis() + 24 * 3_600_000;

  assert.equal(result.windowEndMs, calendarCorrect);
  assert.notEqual(result.windowEndMs, elapsedWrong);
});

// case 31
test("quarter-hour offset zone (Asia/Kathmandu) lands cells on UTC :15 and :45", () => {
  const venue = baseVenue({ timezone: "Asia/Kathmandu", openingHours: allWeek("14:00", "02:00") });
  const result = generateSlotGrid(venue, "2026-08-07");
  assert.equal(result.kind, "open");
  if (result.kind !== "open") return;
  assert.equal(result.cells.length, 24); // matches case 22's count
  for (const cell of result.cells) {
    const minute = new Date(cell.cellStartMs).getUTCMinutes();
    assert.ok(minute === 15 || minute === 45, `expected :15 or :45, got :${minute}`);
  }
});

// case 32
test("window boundaries hold across a spread of scenarios", () => {
  const scenarios: [VenueSchedule, string][] = [
    [baseVenue(), "2026-08-10"],
    [baseVenue({ openingHours: allWeek("14:00", "02:00") }), "2026-08-07"],
    [
      baseVenue({ timezone: "America/New_York", openingHours: allWeek("00:00", "06:00") }),
      "2026-03-08",
    ],
    [
      baseVenue({ timezone: "America/New_York", openingHours: allWeek("14:00", "02:00") }),
      "2026-10-31",
    ],
  ];
  for (const [venue, date] of scenarios) {
    const result = generateSlotGrid(venue, date);
    assertWindowBounds(result);
  }
});

// case 33
test("southern hemisphere midnight crossing over both October and April transitions", () => {
  const venue = baseVenue({
    timezone: "Australia/Sydney",
    openingHours: allWeek("18:00", "03:00"),
  });
  const october = generateSlotGrid(venue, "2026-10-03"); // crosses the spring-forward gap
  const octoberNeighbor = generateSlotGrid(venue, "2026-10-02");
  const april = generateSlotGrid(venue, "2026-04-04"); // crosses the fall-back overlap
  const aprilNeighbor = generateSlotGrid(venue, "2026-04-03");
  assert.equal(october.kind, "open");
  assert.equal(octoberNeighbor.kind, "open");
  assert.equal(april.kind, "open");
  assert.equal(aprilNeighbor.kind, "open");
  if (
    october.kind !== "open" ||
    octoberNeighbor.kind !== "open" ||
    april.kind !== "open" ||
    aprilNeighbor.kind !== "open"
  ) {
    return;
  }
  assert.ok(october.cells.length < octoberNeighbor.cells.length);
  assert.ok(april.cells.length > aprilNeighbor.cells.length);
});
