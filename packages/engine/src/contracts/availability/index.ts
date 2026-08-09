import { z } from "zod";
import { availabilityCellSchema } from "../cell/index.js";
import { localDateSchema, objectIdSchema } from "../primitives/index.js";
import { stationKindSchema } from "../station/index.js";
import { CLOSED_REASONS } from "../../constants/closed-reason/index.js";

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
      reason: z.nativeEnum(CLOSED_REASONS),
    })
    .nullable(),
  degraded: z.boolean(), // true when Redis was unreachable; held cells reported as free
  cells: z.array(availabilityCellSchema),
});

export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;