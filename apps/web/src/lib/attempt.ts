// The booking attempt record: the client's entire memory of a booking in
// progress (milestone-3-spec.md section 5). sessionStorage, never
// localStorage -- the record is per tab and must die with the tab, the
// correct lifetime for a five-minute hold.
//
// Section 5 puts readAttempt/writeAttempt/clearAttempt in lib/grid.ts; that
// file was never built (its grid is dead scope), so they live here instead.
// This file owns every sessionStorage key this app writes.
import type { CreateBookingRequest } from "@playstop/engine";

const STORAGE_KEY = "playstop.attempt";
const SELECTED_DATE_STORAGE_KEY = "playstop.selectedDate";

/** The date strip's picked day (screen 1), so it survives navigating into
 *  screens 2-4 and back. Session-lived like the attempt record above: a new
 *  tab starts back on tonight. */
export function readSelectedDate(): string | null {
  try {
    return sessionStorage.getItem(SELECTED_DATE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeSelectedDate(date: string): void {
  try {
    sessionStorage.setItem(SELECTED_DATE_STORAGE_KEY, date);
  } catch {
    // sessionStorage unavailable; the strip just falls back to tonight
  }
}

export interface BookingAttempt {
  readonly idempotencyKey: string; // crypto.randomUUID(), created once per attempt
  readonly stationId: string;
  readonly startsAt: string; // ISO instant, verbatim from the cell
  readonly slotCount: number;
  readonly hold:
    | null // degraded mode: no hold could be acquired, see section 9
    | {
        readonly holdId: string;
        readonly expiresAt: string;
        readonly ttlSeconds: number;
        readonly quoteMinor: number;
        readonly currency: string;
      };
  /** Set on the first confirm submit and never mutated; retries resend this verbatim. */
  readonly submitted: null | CreateBookingRequest;
  /** Set when a confirm POST failed without a server answer. Locks the form. */
  readonly outcomeUnknown: boolean;
}

// `hold` is checked field by field rather than for mere presence: this
// value comes back from sessionStorage, which the user can edit, and a hold
// missing expiresAt would reach classifyReload as Date.parse(undefined) =>
// NaN, whose comparison is false, so a broken record would classify as
// "resume" and render a countdown against nothing.
function isHold(value: unknown): value is NonNullable<BookingAttempt["hold"]> {
  if (typeof value !== "object" || value === null) return false;
  const hold = value as Record<string, unknown>;
  return (
    typeof hold.holdId === "string" &&
    typeof hold.expiresAt === "string" &&
    Number.isFinite(Date.parse(hold.expiresAt)) &&
    typeof hold.ttlSeconds === "number" &&
    typeof hold.quoteMinor === "number" &&
    typeof hold.currency === "string"
  );
}

function isBookingAttempt(value: unknown): value is BookingAttempt {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.idempotencyKey === "string" &&
    typeof record.stationId === "string" &&
    typeof record.startsAt === "string" &&
    typeof record.slotCount === "number" &&
    typeof record.outcomeUnknown === "boolean" &&
    (record.hold === null || isHold(record.hold)) &&
    "submitted" in record
  );
}

/** Tolerates a corrupt or absent value: returns null and deletes the key. */
export function readAttempt(): BookingAttempt | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearAttempt();
    return null;
  }
  if (!isBookingAttempt(parsed)) {
    clearAttempt();
    return null;
  }
  return parsed;
}

/** The range this tab holds right now, for availability's owner-aware view
 *  (freeOwnHeldCells). Null in degraded mode (no hold) or with no attempt.
 *  ponytail: an expired hold is not filtered out; the cell then reads free
 *  until the next refetch and the arbiter decides at hold time anyway. */
export function ownHoldOf(attempt: BookingAttempt | null) {
  return attempt?.hold
    ? { stationId: attempt.stationId, startsAt: attempt.startsAt, slotCount: attempt.slotCount }
    : null;
}

export function writeAttempt(attempt: BookingAttempt): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // sessionStorage unavailable (private mode, quota) -- the attempt just
    // won't survive a reload; any hold already created is unaffected.
  }
}

export function clearAttempt(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clean up
  }
}

/** The route's booking-attempt-shaped search params, for comparing against
 *  a stored attempt. `slots` is `search.slots` from book.station.tsx, which
 *  is `undefined` before a length is picked -- that case never reaches the
 *  classifier below (screen 4 only renders once `slots` is set). */
export interface RouteBookingParams {
  readonly stationId: string;
  readonly startsAt: string;
  readonly slotCount: number;
}

export type ReloadCase =
  | { readonly kind: "resume"; readonly hold: NonNullable<BookingAttempt["hold"]> }
  | { readonly kind: "expired" }
  | { readonly kind: "degraded" }
  | { readonly kind: "resume-prompt" };

/** The four-case reload table, milestone-3-spec.md section 5 "Reload
 *  mid-flow". Pure: no storage read, no Date.now() -- callers pass the
 *  attempt (or null) and the current instant so this is testable without a
 *  DOM. `expiresAt === nowMs` counts as expired, matching `countdownState`
 *  (`Math.max(0, expiresAt - nowMs) === 0` is already "expired" there). */
export function classifyReload(attempt: BookingAttempt | null, route: RouteBookingParams, nowMs: number): ReloadCase {
  if (
    !attempt ||
    attempt.stationId !== route.stationId ||
    attempt.startsAt !== route.startsAt ||
    attempt.slotCount !== route.slotCount
  ) {
    return { kind: "resume-prompt" };
  }
  if (attempt.hold === null) return { kind: "degraded" };
  if (Date.parse(attempt.hold.expiresAt) <= nowMs) return { kind: "expired" };
  return { kind: "resume", hold: attempt.hold };
}
