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

export function saveBooking(entry: SavedBooking): void {
  try {
    const others = readBookings().filter((saved) => saved.id !== entry.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...others].slice(0, MAX_ENTRIES)));
  } catch {
    // localStorage unavailable; the booking just won't appear in the list
  }
}
