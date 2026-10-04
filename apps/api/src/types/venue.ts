import type { VenueSchedule } from "@playstop/engine";

export type EngineVenueSchedule = VenueSchedule & { leadTimeMinutes: number; maxAdvanceDays: number };

export interface ResolvedCells {
  readonly businessDate: string;
  readonly playMs: readonly number[];
  readonly bufferMs: readonly number[];
}
