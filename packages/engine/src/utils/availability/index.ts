import type {
  AvailabilityCell,
  AvailabilityInput,
  AvailabilityResult,
  CellState,
  OccupiedCell,
  StationInput,
} from "@playstop/types";
import type { GridCell } from "../grid/index.js";
import { generateSlotGrid } from "../grid/index.js";

export type { AvailabilityCell, AvailabilityInput, AvailabilityResult, CellState, OccupiedCell, StationInput };

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