import { z } from "zod";
import { objectIdSchema } from "../primitives/index.js";
import { STATION_KINDS } from "@playstop/types";

export const stationKindSchema = z.nativeEnum(STATION_KINDS);

export const stationSummarySchema = z.object({
  id: objectIdSchema,
  slug: z.string(),
  name: z.string(),
  kind: stationKindSchema,
  capacity: z.number().int(),
  hourlyRateMinor: z.number().int(),
  minSlots: z.number().int(),
  maxSlots: z.number().int(),
});

export type StationSummary = z.infer<typeof stationSummarySchema>;