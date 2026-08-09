import type { StationInput } from "../availability/index.js";

/**
 * `hourlyRateMinor * slotCount * gridMinutes / 60`, integer minor units.
 * Seed-time validation on the station guarantees this divides evenly; the
 * assertion here is a safety net, not a rounding rule.
 */
export function priceBooking(
  station: Pick<StationInput, "hourlyRateMinor">,
  gridMinutes: number,
  slotCount: number,
): number {
  const totalMinor = (station.hourlyRateMinor * slotCount * gridMinutes) / 60;
  if (!Number.isInteger(totalMinor)) {
    throw new Error(
      `priceBooking produced a non-integer amount (${totalMinor}); station.hourlyRateMinor * gridMinutes must be a multiple of 60`,
    );
  }
  return totalMinor;
}