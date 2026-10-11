import type { AvailabilityResult, StationSummary } from "@playstop/engine";

export interface AvailabilitySnapshot {
  readonly result: AvailabilityResult;
  readonly stations: StationSummary[];
  readonly degraded: boolean;
}
