// The device-local "your bookings" list: every booking this browser has
// opened on the confirmation screen, so a player with two or more can find
// them again. localStorage, unlike lib/attempt.ts's sessionStorage: this
// must outlive the tab. This file owns the localStorage key this app writes.
//
// ponytail: device-local on purpose. No account, no API call; the list
// clears with site data and never follows the player to another device.
// Upgrade path is a server-side "bookings by contact" lookup behind OTP.
import { STATION_KINDS, type StationKind } from "@playstop/types";

const STORAGE_KEY = "playstop.bookings";
const MAX_ENTRIES = 20;

export interface SavedBooking {
  readonly id: string;
  readonly code: string;
  readonly stationName: string;
  readonly kind: StationKind;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  readonly savedAtMs: number;
}

const STATION_KIND_VALUES: readonly unknown[] = Object.values(STATION_KINDS);

// The value comes back from localStorage, which the user can edit, so each
// field is checked; a junk entry is dropped rather than rendered.
function isSavedBooking(value: unknown): value is SavedBooking {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.code === "string" &&
    typeof entry.stationName === "string" &&
    STATION_KIND_VALUES.includes(entry.kind) &&
    Number.isFinite(entry.startsAtMs) &&
    Number.isFinite(entry.endsAtMs) &&
    Number.isFinite(entry.savedAtMs)
  );
}

/** Newest first. Any storage or parse failure degrades to an empty list. */
export function readBookings(): SavedBooking[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSavedBooking)
      .sort((a, b) => b.savedAtMs - a.savedAtMs)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** Upserts by booking id (a re-open refreshes the entry, never duplicates
 *  it) and keeps the newest MAX_ENTRIES. Silent no-op if storage is
 *  unavailable (private mode, quota). */
export function saveBooking(entry: SavedBooking): void {
  try {
    const others = readBookings().filter((saved) => saved.id !== entry.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...others].slice(0, MAX_ENTRIES)));
  } catch {
    // localStorage unavailable; the booking just won't appear in the list
  }
}
