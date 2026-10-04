import type { CreateBookingRequest } from "@playstop/engine";

const STORAGE_KEY = "playstop.attempt";
const SELECTED_DATE_STORAGE_KEY = "playstop.selectedDate";

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
  readonly idempotencyKey: string;
  readonly stationId: string;
  readonly startsAt: string;
  readonly slotCount: number;
  readonly hold:
    | null
    | {
        readonly holdId: string;
        readonly expiresAt: string;
        readonly ttlSeconds: number;
        readonly quoteMinor: number;
        readonly currency: string;
      };
  readonly submitted: null | CreateBookingRequest;
  readonly outcomeUnknown: boolean;
}

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

export function ownHoldOf(attempt: BookingAttempt | null) {
  if (!attempt?.hold) return null;
  if (Date.parse(attempt.hold.expiresAt) <= Date.now()) return null;
  return { stationId: attempt.stationId, startsAt: attempt.startsAt, slotCount: attempt.slotCount };
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
