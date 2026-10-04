import type { VenueResponse } from "@playstop/engine";

type OpeningHours = VenueResponse["openingHours"];
type WeekdayKey = keyof OpeningHours;

const localDate = (timezone: string, at: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);

const localTime = (timezone: string, at: Date): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    at,
  );

const weekdayOf = (yyyyMmDd: string): WeekdayKey =>
  String(new Date(`${yyyyMmDd}T00:00:00Z`).getUTCDay()) as WeekdayKey;

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

export function businessDateLabel(
  venue: Pick<VenueResponse, "timezone" | "openingHours">,
  now: Date,
  date: string,
): string {
  const today = currentBusinessDate(venue, now);
  const offsetDays = Math.round(
    (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000,
  );
  const label = dateChipLabel(offsetDays, date);
  return label === "Today" ? "Tonight" : label;
}

export interface BusinessDateChip {
  readonly date: string;
  readonly label: string;
}

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
