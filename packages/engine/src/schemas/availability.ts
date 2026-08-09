import { z } from "zod";
import type { ClosedReason } from "@playstop/types";
import { availabilityCellSchema } from "./cell.js";
import { localDateSchema, objectIdSchema } from "./primitives.js";
import { stationKindSchema } from "./station.js";

export const availabilityQuerySchema = z.object({
  date: localDateSchema, // required, the business date the session opens on
  stationId: objectIdSchema.optional(),
  kind: stationKindSchema.optional(),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

// The three reasons are declared exactly once, in packages/types' ClosedReason
// union (also used by GridResult and AvailabilityResult). `satisfies` fails
// the build the moment this array drifts from that union.
const closedReasons = ["weekday_closed", "blackout", "no_valid_hours"] as const satisfies readonly ClosedReason[];

export const availabilityResponseSchema = z.object({
  businessDate: z.string(),
  timezone: z.string(),
  gridMinutes: z.number().int(),
  closed: z
    .object({
      reason: z.enum(closedReasons),
    })
    .nullable(),
  degraded: z.boolean(), // true when Redis was unreachable; held cells reported as free
  cells: z.array(availabilityCellSchema),
});

export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;
