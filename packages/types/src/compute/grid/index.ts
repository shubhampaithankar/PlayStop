import type { ClosedReason } from "../../closed-reason/index.js";

export interface VenueSchedule {
  readonly timezone: string;
  readonly gridMinutes: number;
  readonly bufferMinutes: number;
  readonly openingHours: Readonly<
    Record<
      "0" | "1" | "2" | "3" | "4" | "5" | "6",
      { readonly open: string; readonly close: string } | null
    >
  >;
  readonly blackoutDates: readonly string[];
}

export interface GridCell {
  readonly cellStartMs: number;
  readonly cellEndMs: number;
  readonly localLabel: string;
}

export type GridResult =
  | {
      readonly kind: "open";
      readonly cells: readonly GridCell[];
      readonly windowStartMs: number;
      readonly windowEndMs: number;
    }
  | {
      readonly kind: "closed";
      readonly reason: ClosedReason;
      readonly windowStartMs: number;
      readonly windowEndMs: number;
    };
