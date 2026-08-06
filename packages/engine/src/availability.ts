import type { GridCell, VenueSchedule } from "./grid.js";
import { generateSlotGrid } from "./grid.js";

export interface StationInput {
  readonly stationId: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: "ps5" | "ps3" | "ps2" | "racing-sim";
  readonly capacity: number;
  readonly hourlyRateMinor: number;
  readonly minSlots: number;
  readonly maxSlots: number;
  readonly maintenanceWindows: readonly {
    readonly startsAtMs: number;
    readonly endsAtMs: number;
  }[];
}

export interface OccupiedCell {
  readonly stationId: string;
  readonly cellStartMs: number;
}

export interface AvailabilityInput {
  readonly venue: VenueSchedule & { readonly leadTimeMinutes: number; readonly maxAdvanceDays: number };
  readonly businessDate: string;
  readonly stations: readonly StationInput[]; // caller passes ACTIVE stations only
  readonly claims: readonly OccupiedCell[]; // confirmed slot_claims, from Mongo
  readonly holds: readonly OccupiedCell[]; // from Redis; empty array when Redis is degraded
  readonly nowMs: number;
}

export type CellState = "free" | "held" | "booked" | "maintenance" | "past" | "too_far_ahead";

export interface AvailabilityCell {
  readonly stationId: string;
  readonly startsAt: string; // ISO 8601 UTC
  readonly endsAt: string;
  readonly localLabel: string;
  readonly state: CellState;
}

export interface AvailabilityResult {
  readonly businessDate: string;
  readonly timezone: string;
  readonly gridMinutes: number;
  readonly closed: null | { readonly reason: "weekday_closed" | "blackout" | "no_valid_hours" };
  readonly cells: readonly AvailabilityCell[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;
}

function occupiedKey(stationId: string, cellStartMs: number): string {
  return `${stationId}:${cellStartMs}`;
}

// State precedence, applied in this exact order: first match wins.
function resolveCellState(
  cell: GridCell,
  station: StationInput,
  claimed: ReadonlySet<string>,
  held: ReadonlySet<string>,
  leadTimeMinutes: number,
  maxAdvanceDays: number,
  nowMs: number,
): CellState {
  if (cell.cellStartMs < nowMs + leadTimeMinutes * 60_000) return "past";
  if (cell.cellStartMs > nowMs + maxAdvanceDays * 86_400_000) return "too_far_ahead";

  const inMaintenance = station.maintenanceWindows.some(
    (window) => cell.cellStartMs < window.endsAtMs && cell.cellEndMs > window.startsAtMs,
  );
  if (inMaintenance) return "maintenance";

  const key = occupiedKey(station.stationId, cell.cellStartMs);
  // Booked ranks above held: if both exist for the same cell (a hold that
  // was confirmed but whose release lost a race), the truthful answer is
  // "booked".
  if (claimed.has(key)) return "booked";
  if (held.has(key)) return "held";
  return "free";
}

export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const { venue, businessDate, stations, claims, holds, nowMs } = input;
  const grid = generateSlotGrid(venue, businessDate);

  if (grid.kind === "closed") {
    return {
      businessDate,
      timezone: venue.timezone,
      gridMinutes: venue.gridMinutes,
      closed: { reason: grid.reason },
      cells: [],
      windowStartMs: grid.windowStartMs,
      windowEndMs: grid.windowEndMs,
    };
  }

  const claimed = new Set(claims.map((c) => occupiedKey(c.stationId, c.cellStartMs)));
  const held = new Set(holds.map((c) => occupiedKey(c.stationId, c.cellStartMs)));

  const cells: AvailabilityCell[] = [];
  for (const station of stations) {
    for (const cell of grid.cells) {
      cells.push({
        stationId: station.stationId,
        startsAt: new Date(cell.cellStartMs).toISOString(),
        endsAt: new Date(cell.cellEndMs).toISOString(),
        localLabel: cell.localLabel,
        state: resolveCellState(
          cell,
          station,
          claimed,
          held,
          venue.leadTimeMinutes,
          venue.maxAdvanceDays,
          nowMs,
        ),
      });
    }
  }

  return {
    businessDate,
    timezone: venue.timezone,
    gridMinutes: venue.gridMinutes,
    closed: null,
    cells,
    windowStartMs: grid.windowStartMs,
    windowEndMs: grid.windowEndMs,
  };
}
