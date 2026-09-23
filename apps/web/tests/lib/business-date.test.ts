import { test } from "node:test";
import assert from "node:assert/strict";
import { businessDateStrip, currentBusinessDate } from "../../src/lib/business-date.js";

// America/New_York, matching the DST commentary in business-date.ts.
const NY = "America/New_York";

// Session opens Friday (weekday 5) 8pm, crosses midnight, closes 2am.
const crossingHours = {
  "0": null,
  "1": null,
  "2": null,
  "3": null,
  "4": null,
  "5": { open: "20:00", close: "02:00" },
  "6": null,
} as const;

// A same-day session, 10am-11pm, never crosses midnight.
const nonCrossingHours = {
  "0": null,
  "1": null,
  "2": null,
  "3": null,
  "4": null,
  "5": { open: "10:00", close: "23:00" },
  "6": null,
} as const;

const closedHours = {
  "0": null,
  "1": null,
  "2": null,
  "3": null,
  "4": null,
  "5": null,
  "6": null,
} as const;

test("mid-evening, mid-session -> returns today's date", () => {
  // 2026-08-28 is a Friday.
  const now = new Date("2026-08-28T22:00:00-04:00"); // 10pm EDT
  const venue = { timezone: NY, openingHours: crossingHours };
  assert.equal(currentBusinessDate(venue, now), "2026-08-28");
});

test("1am during a midnight-crossing session -> returns yesterday's date", () => {
  // Friday night's session is still running at 1am Saturday.
  const now = new Date("2026-08-29T01:00:00-04:00"); // 1am EDT Saturday
  const venue = { timezone: NY, openingHours: crossingHours };
  assert.equal(currentBusinessDate(venue, now), "2026-08-28");
});

test("1am when yesterday was closed -> returns today's date", () => {
  const now = new Date("2026-08-29T01:00:00-04:00"); // 1am EDT Saturday
  const venue = { timezone: NY, openingHours: closedHours };
  assert.equal(currentBusinessDate(venue, now), "2026-08-29");
});

test("a weekday with null opening hours -> returns today's date", () => {
  const now = new Date("2026-08-26T22:00:00-04:00"); // Wednesday, closed
  const venue = { timezone: NY, openingHours: closedHours };
  assert.equal(currentBusinessDate(venue, now), "2026-08-26");
});

test("a non-crossing session never returns yesterday, even past its close", () => {
  // Saturday 1am: yesterday (Friday) closed at 23:00 non-crossing, so "today" stands.
  const now = new Date("2026-08-29T01:00:00-04:00");
  const venue = { timezone: NY, openingHours: nonCrossingHours };
  assert.equal(currentBusinessDate(venue, now), "2026-08-29");
});


test("businessDateStrip: 7 chips, today..+6, labelled Today/Tomorrow/weekday+date", () => {
  const now = new Date("2026-08-28T22:00:00-04:00"); // Friday 10pm EDT, mid-session
  const venue = { timezone: NY, openingHours: crossingHours };
  const chips = businessDateStrip(venue, now);
  assert.deepEqual(
    chips.map((c) => c.date),
    ["2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03"],
  );
  assert.equal(chips[0]?.label, "Today");
  assert.equal(chips[1]?.label, "Tomorrow");
  assert.equal(chips[2]?.label, "Sun 30");
  assert.equal(chips[6]?.label, "Thu 3");
});

test("businessDateStrip: anchored on the running session's date after midnight, not the calendar date", () => {
  // 1am Saturday, still inside Friday's crossing session -- the strip
  // starts on Friday's date (currentBusinessDate), not Saturday's.
  const now = new Date("2026-08-29T01:00:00-04:00");
  const venue = { timezone: NY, openingHours: crossingHours };
  const chips = businessDateStrip(venue, now);
  assert.equal(chips[0]?.date, "2026-08-28");
});

test("businessDateStrip: calendar-date arithmetic crosses a DST transition without skipping or repeating a date", () => {
  // 2026-11-01 is the US fall-back Sunday. The strip is pure UTC date-only
  // string arithmetic (addDaysToDateOnly), never wall-clock arithmetic, so
  // it is unaffected by the repeated local hour.
  const now = new Date("2026-10-29T10:00:00-04:00"); // Thursday, EDT
  const venue = { timezone: NY, openingHours: nonCrossingHours };
  const chips = businessDateStrip(venue, now);
  assert.deepEqual(
    chips.map((c) => c.date),
    ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"],
  );
});