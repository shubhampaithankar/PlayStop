import { z } from "zod";
import { availabilityCellSchema } from "../cell/index.js";
import { isoInstantSchema, localDateSchema, objectIdSchema } from "../primitives/index.js";
import { stationKindSchema } from "../station/index.js";
import { CLOSED_REASONS } from "@playstop/types";

export const availabilityQuerySchema = z.object({
  date: localDateSchema,
  stationId: objectIdSchema.optional(),
  kind: stationKindSchema,
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
  degraded: z.boolean(),
  cells: z.array(availabilityCellSchema),
});

export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

export const availabilitySummaryQuerySchema = z.object({
  date: localDateSchema,
  ownStationId: objectIdSchema.optional(),
  ownStartsAt: isoInstantSchema.optional(),
  ownSlotCount: z.coerce.number().int().positive().optional(),
});

export type AvailabilitySummaryQuery = z.infer<typeof availabilitySummaryQuerySchema>;

export const kindSummarySchema = z.discriminatedUnion("status", [
  z.object({
    kind: stationKindSchema,
    status: z.literal("free_now"),
    freeCount: z.number().int().positive(),
    pickStationId: objectIdSchema,
  }),
  z.object({
    kind: stationKindSchema,
    status: z.literal("free_from"),
    timeLabel: z.string(),
    pickStationId: objectIdSchema,
  }),
  z.object({ kind: stationKindSchema, status: z.literal("maintenance") }),
  z.object({ kind: stationKindSchema, status: z.literal("booked_out") }),
]);

export type KindSummary = z.infer<typeof kindSummarySchema>;

export const availabilitySummaryResponseSchema = z.object({
  businessDate: z.string(),
  closed: z.object({ reason: z.nativeEnum(CLOSED_REASONS) }).nullable(),
  degraded: z.boolean(),
  kinds: z.array(kindSummarySchema),
});

export type AvailabilitySummaryResponse = z.infer<typeof availabilitySummaryResponseSchema>;
