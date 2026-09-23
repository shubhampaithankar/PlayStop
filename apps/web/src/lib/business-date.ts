// Which business date is "tonight" for a venue that may run past local
// midnight (milestone-3-spec section 4's opening-hours shape, DESIGN.md:
// no date picker, the app is tonight-only). Wall-clock string comparisons
// only, never epoch math -- see the DST note on currentBusinessDate.
import type { VenueResponse } from "@playstop/engine";

type OpeningHours = VenueResponse["openingHours"];
type WeekdayKey = keyof OpeningHours;

const localDate = (timezone: string, at: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);

const localTime = (timezone: string, at: Date): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    at,
  );

/** Weekday (0=Sunday..6=Saturday) of a "YYYY-MM-DD" string. Calendar-date
 *  arithmetic, not wall-clock arithmetic: a date-only string's weekday does
 *  not depend on timezone, so parsing it as UTC midnight is exact. */
const weekdayOf = (yyyyMmDd: string): WeekdayKey =>
  String(new Date(`${yyyyMmDd}T00:00:00Z`).getUTCDay()) as WeekdayKey;

/**
 * The YYYY-MM-DD business date whose session is running or next to run.
 *
 * DST-safe by construction, because both sides of the "< close" compare are
 * wall-clock strings, never instants: during fall-back, local 01:30 occurs
 * twice and reads "< 02:00" both times, so the result does not flip mid-way
 * through the repeated hour. During spring-forward the clock jumps 01:59
 * straight to 03:00, so a wall-clock close time like "02:00" that never
 * occurred simply never compares true, and today's date is returned --
 * exactly correct, since there was no such moment to be "before".
 */
export function currentBusinessDate(venue: Pick<VenueResponse, "timezone" | "openingHours">, now: Date): string {
  const today = localDate(venue.timezone, now);
  const yesterday = localDate(venue.timezone, new Date(now.getTime() - 86_400_000));
  const currentTime = localTime(venue.timezone, now);

  const yesterdaySession = venue.openingHours[weekdayOf(yesterday)];
  if (yesterdaySession !== null) {
    const crossesMidnight = yesterdaySession.close <= yesterdaySession.open;
    if (crossesMidnight && currentTime < yesterdaySession.close) return yesterday;
  }
  return today;
}

/** "YYYY-MM-DD" plus N days, calendar-date arithmetic only: like weekdayOf
 *  above, a date-only string's day count does not depend on timezone, so
 *  parsing it as UTC midnight and stepping UTC days is exact. */
function addDaysToDateOnly(yyyyMmDd: string, days: number): string {
  const date = new Date(`${yyyyMmDd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateChipLabel(offsetDays: number, yyyyMmDd: string): string {
  if (offsetDays === 0) return "Today";
  if (offsetDays === 1) return "Tomorrow";
  const date = new Date(`${yyyyMmDd}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(date);
  return `${weekday} ${day}`;
}

export interface BusinessDateChip {
  readonly date: string; // "YYYY-MM-DD"
  readonly label: string; // "Today" | "Tomorrow" | "Mon 29"
}

/** The 7-chip date strip (booking-guardrails-otp-design.md: rolling 7 days,
 *  today..+6, venue-local, one source of truth is venue.maxAdvanceDays = 6).
 *  Anchored on currentBusinessDate so a venue mid-session that has already
 *  crossed midnight still starts the strip on the running session's date. */
export function businessDateStrip(
  venue: Pick<VenueResponse, "timezone" | "openingHours">,
  now: Date,
): BusinessDateChip[] {
  const today = currentBusinessDate(venue, now);
  return Array.from({ length: 7 }, (_, offsetDays) => {
    const date = addDaysToDateOnly(today, offsetDays);
    return { date, label: dateChipLabel(offsetDays, date) };
  });
}
