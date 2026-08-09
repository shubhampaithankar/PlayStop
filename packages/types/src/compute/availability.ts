import type { StationKind } from "../station-kind.js";
import type { ClosedReason, VenueSchedule } from "./grid.js";

export interface StationInput {
  readonly stationId: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: StationKind;
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

// The one declaration of a cell's availability state. packages/engine builds
// cellStateSchema (Zod, for wire validation) from this exact union via a
// `satisfies` check, replacing what used to be a runtime sync test.
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
  readonly closed: null | { readonly reason: ClosedReason };
  readonly cells: readonly AvailabilityCell[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;
}
