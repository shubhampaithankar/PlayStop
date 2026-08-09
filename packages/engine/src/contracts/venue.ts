import { z } from "zod";
import { localDateSchema } from "./primitives.js";
import { stationSummarySchema } from "./station.js";

const openingHoursDaySchema = z
  .object({ open: z.string(), close: z.string() })
  .nullable();

// Keyed by the weekday the session OPENS on, 0 = Sunday through 6 = Saturday
// (Luxon weekday % 7). close <= open means the session runs past local
// midnight; null means closed that weekday.
const openingHoursSchema = z.object({
  "0": openingHoursDaySchema,
  "1": openingHoursDaySchema,
  "2": openingHoursDaySchema,
  "3": openingHoursDaySchema,
  "4": openingHoursDaySchema,
  "5": openingHoursDaySchema,
  "6": openingHoursDaySchema,
});

export const venueResponseSchema = z.object({
  id: z.string(), // ObjectId hex
  slug: z.string(),
  name: z.string(),
  timezone: z.string(), // IANA
  gridMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  currency: z.string(),
  openingHours: openingHoursSchema,
  blackoutDates: z.array(localDateSchema),
  leadTimeMinutes: z.number().int(),
  maxAdvanceDays: z.number().int(),
  stations: z.array(stationSummarySchema), // active only
});

export type VenueResponse = z.infer<typeof venueResponseSchema>;
