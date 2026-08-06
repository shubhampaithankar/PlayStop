import { DateTime } from "luxon";

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

export type GridResult =
  | {
      readonly kind: "open";
      readonly cells: readonly GridCell[];
      readonly windowStartMs: number;
      readonly windowEndMs: number;
    }
  | {
      readonly kind: "closed";
      readonly reason: "weekday_closed" | "blackout" | "no_valid_hours";
      readonly windowStartMs: number;
      readonly windowEndMs: number;
    };

export class InvalidOpeningHoursError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOpeningHoursError";
  }
}

export class InvalidGridMinutesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGridMinutesError";
  }
}

export class SlotNotOnGridError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotNotOnGridError";
  }
}

export class SlotOutOfWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotOutOfWindowError";
  }
}

type WeekdayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";

function weekdayKeyOf(businessDate: string, timezone: string): WeekdayKey {
  // Luxon DateTime.weekday is 1 (Monday) through 7 (Sunday). openingHours is
  // keyed 0 (Sunday) through 6 (Saturday), so % 7 maps Sunday to "0".
  const luxonWeekday = DateTime.fromISO(businessDate, { zone: timezone }).weekday;
  return String(luxonWeekday % 7) as WeekdayKey;
}

// Opening time takes the EARLIEST candidate, closing time takes the LATEST.
// This maximizes the open window ("we are open from 2pm until 2am, whatever
// the clock does in between"). Luxon documents fall-back resolution as
// undefined by default, so this is decided explicitly via
// getPossibleOffsets() rather than relied upon.
function resolveInstant(local: DateTime, boundary: "earliest" | "latest"): number {
  const candidates = local.getPossibleOffsets();
  const chosen = boundary === "earliest" ? candidates[0] : candidates[candidates.length - 1];
  if (!chosen) {
    throw new Error(`getPossibleOffsets() returned no candidates for ${local.toISO()}`);
  }
  return chosen.toMillis();
}

/**
 * For a requested business date and venue, resolves the session boundaries
 * and emits the 30-minute cell grid. A business day is the session that
 * OPENS on the local calendar date `businessDate`; a session whose close is
 * on-or-before its open (as wall-clock strings) runs past local midnight and
 * every cell in it, including the post-midnight tail, belongs to this
 * business date.
 */
export function generateSlotGrid(venue: VenueSchedule, businessDate: string): GridResult {
  if (venue.gridMinutes <= 0 || 60 % venue.gridMinutes !== 0) {
    throw new InvalidGridMinutesError(
      `gridMinutes (${venue.gridMinutes}) must be a positive divisor of 60`,
    );
  }

  const midnightD = DateTime.fromISO(businessDate, { zone: venue.timezone }).startOf("day");
  const midnightD1 = midnightD.plus({ days: 1 });
  // Closed responses (any reason) report local midnight D to D+1. The caller
  // skips the Mongo read entirely when closed, so these values are
  // informational only.
  const closedWindowStartMs = midnightD.toMillis();
  const closedWindowEndMs = midnightD1.toMillis();

  const weekdayKey = weekdayKeyOf(businessDate, venue.timezone);
  const hours = venue.openingHours[weekdayKey];
  if (hours === null) {
    return {
      kind: "closed",
      reason: "weekday_closed",
      windowStartMs: closedWindowStartMs,
      windowEndMs: closedWindowEndMs,
    };
  }
  if (venue.blackoutDates.includes(businessDate)) {
    return {
      kind: "closed",
      reason: "blackout",
      windowStartMs: closedWindowStartMs,
      windowEndMs: closedWindowEndMs,
    };
  }

  const openLocal = DateTime.fromISO(`${businessDate}T${hours.open}`, { zone: venue.timezone });
  let closeLocal = DateTime.fromISO(`${businessDate}T${hours.close}`, { zone: venue.timezone });

  // Compare the wall-clock strings, not the resolved instants: this is a
  // lexicographic (== numeric, zero-padded HH:MM) comparison decided before
  // any zone math can perturb it. The roll is calendar-aware (`plus({ days:
  // 1 })`), never elapsed-time (`plus({ hours: 24 })`), so a closing time
  // that reads "2am" still reads "2am" on a DST night.
  if (hours.close <= hours.open) {
    closeLocal = closeLocal.plus({ days: 1 });
  }

  const openInstant = resolveInstant(openLocal, "earliest");
  const closeInstant = resolveInstant(closeLocal, "latest");

  if (closeInstant - openInstant > 86_400_000) {
    throw new InvalidOpeningHoursError(
      `resolved session for ${businessDate} in ${venue.timezone} exceeds 24 hours`,
    );
  }

  const stride = venue.gridMinutes * 60_000;
  if (closeInstant <= openInstant + stride) {
    return {
      kind: "closed",
      reason: "no_valid_hours",
      windowStartMs: closedWindowStartMs,
      windowEndMs: closedWindowEndMs,
    };
  }

  // Real-time arithmetic on epoch milliseconds, never local-time arithmetic.
  // Stepping by elapsed milliseconds from a single resolved anchor cannot
  // produce a nonexistent cell on spring-forward or a duplicate cell on
  // fall-back, because it never constructs an intermediate local time.
  const cells: GridCell[] = [];
  for (let t = openInstant; t + stride <= closeInstant; t += stride) {
    cells.push({
      cellStartMs: t,
      cellEndMs: t + stride,
      localLabel: DateTime.fromMillis(t, { zone: venue.timezone }).toFormat(
        "yyyy-MM-dd HH:mm ZZZZ",
      ),
    });
  }

  return {
    kind: "open",
    cells,
    windowStartMs: openInstant,
    windowEndMs: closeInstant,
  };
}

/**
 * Splits a booking's range into play and buffer cells, reading boundaries
 * from the grid array rather than recomputing them: on a DST night the grid
 * is not a uniform arithmetic sequence in local terms, and the grid array is
 * the only artifact that knows where the real cell boundaries are.
 */
export function buildClaimCells(
  grid: readonly GridCell[],
  startsAtMs: number,
  slotCount: number,
  bufferSlotCount: number,
): { readonly playMs: readonly number[]; readonly bufferMs: readonly number[] } {
  const startIndex = grid.findIndex((cell) => cell.cellStartMs === startsAtMs);
  if (startIndex === -1) {
    throw new SlotNotOnGridError(`${startsAtMs} does not match any grid cell start`);
  }

  const playEndIndex = startIndex + slotCount; // exclusive
  if (playEndIndex > grid.length) {
    throw new SlotOutOfWindowError("booking would extend past closing");
  }
  const playMs = grid.slice(startIndex, playEndIndex).map((cell) => cell.cellStartMs);

  const bufferEndIndex = Math.min(playEndIndex + bufferSlotCount, grid.length);
  const bufferMs = grid.slice(playEndIndex, bufferEndIndex).map((cell) => cell.cellStartMs);

  return { playMs, bufferMs };
}
