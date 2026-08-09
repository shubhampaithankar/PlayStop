// Hand-written structural shapes for packages/engine's slot-grid compute.
// No Zod here: these never cross the wire directly, they describe function
// parameters and return values inside packages/engine.

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
  readonly cellStartMs: number; // UTC epoch ms
  readonly cellEndMs: number; // UTC epoch ms, exclusive
  readonly localLabel: string; // "2026-11-01 01:30 EDT"
}

// The one declaration of "why a business date has no cells". Shared by
// GridResult and AvailabilityResult below, and by packages/engine's wire
// schema for the same field, via a `satisfies` check.
export type ClosedReason = "weekday_closed" | "blackout" | "no_valid_hours";

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
