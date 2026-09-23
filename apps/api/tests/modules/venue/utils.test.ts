// Pure layer (docs/conventions/testing.md): resolveRange takes nowMs as a
// parameter, so every case here is deterministic -- no real clock, no
// Mongo, no Redis. Covers the window-guard split (venue/utils.ts): lead
// time -> SLOT_TOO_SOON, business-date range -> DATE_OUT_OF_RANGE, with the
// -1 post-midnight tolerance preserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectId } from "mongodb";
import { DateTime } from "luxon";
import { generateSlotGrid } from "@playstop/engine";
import type { OpeningHours, StationDoc, VenueDoc } from "#libs/mongo/index.js";
import { DomainError } from "#errors.js";
import { resolveRange } from "#modules/venue/utils.js";

function allWeek(open: string, close: string): OpeningHours {
  const day = { open, close };
  return { "0": day, "1": day, "2": day, "3": day, "4": day, "5": day, "6": day };
}

function buildVenue(overrides: Partial<VenueDoc> = {}): VenueDoc {
  return {
    _id: new ObjectId(),
    slug: "test-venue",
    name: "Test Venue",
    timezone: "Asia/Kolkata",
    gridMinutes: 30,
    bufferMinutes: 0,
    currency: "INR",
    openingHours: allWeek("14:00", "02:00"),
    blackoutDates: [],
    leadTimeMinutes: 30,
    maxAdvanceDays: 6,
    createdAt: new Date(),
    ...overrides,
  };
}

const station: Pick<StationDoc, "maintenanceWindows"> = { maintenanceWindows: [] };

function domainCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  throw new Error("expected resolveRange to throw a DomainError");
}

// "today" = businessDate minus daysAhead days, at one minute past local
// midnight -- close enough to midnight that the session's cells (opening
// 14:00) are always still ahead of nowMs, so this alone never trips the
// lead-time check.
function nowMsForDaysAhead(businessDate: string, timezone: string, daysAhead: number): number {
  return DateTime.fromISO(businessDate, { zone: timezone })
    .minus({ days: daysAhead })
    .startOf("day")
    .plus({ minutes: 1 })
    .toMillis();
}

test("resolveRange window guard", async (t) => {
  const businessDate = "2026-06-01";

  await t.test("a cell before the lead cutoff is 422 SLOT_TOO_SOON", () => {
    const venue = buildVenue();
    const grid = generateSlotGrid(venue, businessDate);
    if (grid.kind !== "open") throw new Error("expected an open grid");
    const cellStart = grid.cells[10]!.cellStartMs;
    const nowMs = cellStart - 10 * 60_000; // 10 minutes out; lead is 30
    assert.equal(domainCodeOf(() => resolveRange(venue, station, cellStart, 1, 0, nowMs)), "SLOT_TOO_SOON");
  });

  await t.test("a cell exactly at the lead boundary is allowed", () => {
    const venue = buildVenue();
    const grid = generateSlotGrid(venue, businessDate);
    if (grid.kind !== "open") throw new Error("expected an open grid");
    const cellStart = grid.cells[10]!.cellStartMs;
    const nowMs = cellStart - venue.leadTimeMinutes * 60_000;
    assert.doesNotThrow(() => resolveRange(venue, station, cellStart, 1, 0, nowMs));
  });

  await t.test("one millisecond inside the lead boundary is 422 SLOT_TOO_SOON", () => {
    const venue = buildVenue();
    const grid = generateSlotGrid(venue, businessDate);
    if (grid.kind !== "open") throw new Error("expected an open grid");
    const cellStart = grid.cells[10]!.cellStartMs;
    const nowMs = cellStart - venue.leadTimeMinutes * 60_000 + 1;
    assert.equal(domainCodeOf(() => resolveRange(venue, station, cellStart, 1, 0, nowMs)), "SLOT_TOO_SOON");
  });

  await t.test("a cell on today's business date is allowed", () => {
    const venue = buildVenue({ leadTimeMinutes: 0 });
    const grid = generateSlotGrid(venue, businessDate);
    if (grid.kind !== "open") throw new Error("expected an open grid");
    const cellStart = grid.cells[0]!.cellStartMs;
    const nowMs = nowMsForDaysAhead(businessDate, venue.timezone, 0);
    assert.doesNotThrow(() => resolveRange(venue, station, cellStart, 1, 0, nowMs));
  });

  await t.test("a cell exactly maxAdvanceDays ahead is allowed", () => {
    const venue = buildVenue({ leadTimeMinutes: 0 });
    const grid = generateSlotGrid(venue, businessDate);
    if (grid.kind !== "open") throw new Error("expected an open grid");
    const cellStart = grid.cells[0]!.cellStartMs;
    const nowMs = nowMsForDaysAhead(businessDate, venue.timezone, venue.maxAdvanceDays);
    assert.doesNotThrow(() => resolveRange(venue, station, cellStart, 1, 0, nowMs));
  });

  await t.test("a cell one day beyond maxAdvanceDays is 422 DATE_OUT_OF_RANGE", () => {
    const venue = buildVenue({ leadTimeMinutes: 0 });
    const grid = generateSlotGrid(venue, businessDate);
    if (grid.kind !== "open") throw new Error("expected an open grid");
    const cellStart = grid.cells[0]!.cellStartMs;
    const nowMs = nowMsForDaysAhead(businessDate, venue.timezone, venue.maxAdvanceDays + 1);
    assert.equal(domainCodeOf(() => resolveRange(venue, station, cellStart, 1, 0, nowMs)), "DATE_OUT_OF_RANGE");
  });

  await t.test("the -1 post-midnight tolerance keeps yesterday's tail cell reachable", () => {
    const venue = buildVenue({ leadTimeMinutes: 0 });
    const grid = generateSlotGrid(venue, businessDate);
    if (grid.kind !== "open") throw new Error("expected an open grid");
    // Last cell of the session: the post-midnight tail, on businessDate's
    // calendar but past local midnight in real time.
    const cellStart = grid.cells[grid.cells.length - 1]!.cellStartMs;
    // "today" is one calendar day ahead of businessDate (the midnight roll
    // already happened), but the tail cell is still a minute ahead of now.
    const nowMs = cellStart - 60_000;
    assert.doesNotThrow(() => resolveRange(venue, station, cellStart, 1, 0, nowMs));
  });

  await t.test("a DST-day cell resolves without throwing", () => {
    // 2026-03-08: US spring-forward Sunday (clocks jump 02:00 -> 03:00).
    const venue = buildVenue({ timezone: "America/New_York", leadTimeMinutes: 0 });
    const dstBusinessDate = "2026-03-08";
    const grid = generateSlotGrid(venue, dstBusinessDate);
    if (grid.kind !== "open") throw new Error("expected an open grid");
    const cellStart = grid.cells[0]!.cellStartMs;
    const nowMs = nowMsForDaysAhead(dstBusinessDate, venue.timezone, 0);
    assert.doesNotThrow(() => resolveRange(venue, station, cellStart, 1, 0, nowMs));
  });
});
