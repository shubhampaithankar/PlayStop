// Plain time-unit conversions used on both sides of the contracts/utils
// boundary (utils/grid, utils/availability, utils/pricing). No luxon import
// here: keeping this module dependency-free means importing it never drags
// luxon into a bundle that only needs the numbers.
export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;
export const MINUTES_PER_HOUR = 60;
