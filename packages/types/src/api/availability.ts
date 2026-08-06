import { z } from "zod";
import { availabilityCellSchema } from "../common/cell.js";
import { localDateSchema, objectIdSchema } from "../common/primitives.js";
import { stationKindSchema } from "../common/station.js";

export const availabilityQuerySchema = z.object({
  date: localDateSchema, // required, the business date the session opens on
  stationId: objectIdSchema.optional(),
  kind: stationKindSchema.optional(),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const availabilityResponseSchema = z.object({
  businessDate: z.string(),
  timezone: z.string(),
  gridMinutes: z.number().int(),
  closed: z
    .object({
      reason: z.enum(["weekday_closed", "blackout", "no_valid_hours"]),
    })
    .nullable(),
  degraded: z.boolean(), // true when Redis was unreachable; held cells reported as free
  cells: z.array(availabilityCellSchema),
});

export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;
