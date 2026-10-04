import { z } from "zod";
import { localDateSchema } from "../primitives/index.js";
import { stationSummarySchema } from "../station/index.js";

const openingHoursDaySchema = z
  .object({ open: z.string(), close: z.string() })
  .nullable();

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
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  gridMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  currency: z.string(),
  openingHours: openingHoursSchema,
  blackoutDates: z.array(localDateSchema),
  leadTimeMinutes: z.number().int(),
  maxAdvanceDays: z.number().int(),
  stations: z.array(stationSummarySchema),
});

export type VenueResponse = z.infer<typeof venueResponseSchema>;
