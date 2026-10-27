import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELL_STATES,
  cellsByStation,
  freeOwnHeldCells,
  freeRunLengthFrom,
  summarizeAvailability,
  type AvailabilityCell,
  type StationSummary,
} from "@playstop/engine";

const ID_A = "a".repeat(24);
const ID_B = "b".repeat(24);
const SLOT_MS = 30 * 60_000;
const BASE_MS = Date.UTC(2030, 0, 1, 10, 0);

function station(id: string, number: number, minSlots = 1): StationSummary {
  return {
    id,
    slug: `ps5-${number}`,
    name: `PS5 #${number}`,
    kind: "ps5",
    capacity: 4,
    hourlyRateMinor: 15000,
    minSlots,
    maxSlots: 8,
  };
}

function row(stationId: string, states: AvailabilityCell["state"][]): AvailabilityCell[] {
  return states.map((state, index) => ({
    stationId,
    startsAt: new Date(BASE_MS + index * SLOT_MS).toISOString(),
    endsAt: new Date(BASE_MS + (index + 1) * SLOT_MS).toISOString(),
    localLabel: `2030-01-01T${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "00" : "30"}`,
    state,
  }));
}

const { FREE, BOOKED, HELD } = CELL_STATES;

test("free_now: count and pick have a real free run of minSlots", () => {
  const stations = [station(ID_A, 1, 2), station(ID_B, 2, 2)];
  const cells = [...row(ID_A, [FREE, BOOKED, FREE, BOOKED]), ...row(ID_B, [FREE, FREE, BOOKED, BOOKED])];
  const [summary] = summarizeAvailability(stations, cells);
  assert.equal(summary?.status, "free_now");
  if (summary?.status !== "free_now") return;
  assert.equal(summary.freeCount, 1);
  assert.equal(summary.pickStationId, ID_B);
  const pickCells = cellsByStation(cells, summary.pickStationId);
  assert.ok(freeRunLengthFrom(pickCells, 0) >= 2);
});

test("everything booked is booked_out", () => {
  const cells = [...row(ID_A, [BOOKED, BOOKED]), ...row(ID_B, [BOOKED, BOOKED])];
  const summaries = summarizeAvailability([station(ID_A, 1), station(ID_B, 2)], cells);
  assert.deepEqual(summaries, [{ kind: "ps5", status: "booked_out", hourlyRateMinor: 15000 }]);
});

test("one free, rest booked: count 1 and that station's id", () => {
  const cells = [...row(ID_A, [BOOKED, BOOKED]), ...row(ID_B, [FREE, BOOKED])];
  const [summary] = summarizeAvailability([station(ID_A, 1), station(ID_B, 2)], cells);
  assert.deepEqual(summary, { kind: "ps5", status: "free_now", hourlyRateMinor: 15000, freeCount: 1, pickStationId: ID_B });
});

test("closed day (no cells) is booked_out for every kind", () => {
  const summaries = summarizeAvailability([station(ID_A, 1)], []);
  assert.deepEqual(summaries, [{ kind: "ps5", status: "booked_out", hourlyRateMinor: 15000 }]);
});

test("free later only: free_from with a pick", () => {
  const cells = row(ID_A, [BOOKED, FREE]);
  const [summary] = summarizeAvailability([station(ID_A, 1)], cells);
  assert.equal(summary?.status, "free_from");
  if (summary?.status === "free_from") assert.equal(summary.pickStationId, ID_A);
});

test("own-held last free station stays free_now for that viewer", () => {
  const cells = [...row(ID_A, [HELD, HELD, BOOKED]), ...row(ID_B, [BOOKED, BOOKED, BOOKED])];
  const stations = [station(ID_A, 1), station(ID_B, 2)];
  assert.equal(summarizeAvailability(stations, cells)[0]?.status, "booked_out");
  const own = { stationId: ID_A, startsAt: cells[0]!.startsAt, slotCount: 2 };
  const [summary] = summarizeAvailability(stations, freeOwnHeldCells(cells, own));
  assert.deepEqual(summary, { kind: "ps5", status: "free_now", hourlyRateMinor: 15000, freeCount: 1, pickStationId: ID_A });
});
