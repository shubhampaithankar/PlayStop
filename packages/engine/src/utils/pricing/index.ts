import type { StationInput } from "../availability/index.js";
import { MINUTES_PER_HOUR } from "../../constants/time/index.js";

export function priceBooking(
  station: Pick<StationInput, "hourlyRateMinor">,
  gridMinutes: number,
  slotCount: number,
): number {
  const totalMinor = (station.hourlyRateMinor * slotCount * gridMinutes) / MINUTES_PER_HOUR;
  if (!Number.isInteger(totalMinor)) {
    throw new Error(
      `priceBooking produced a non-integer amount (${totalMinor}); station.hourlyRateMinor * gridMinutes must be a multiple of 60`,
    );
  }
  return totalMinor;
}