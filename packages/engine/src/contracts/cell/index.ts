import { z } from "zod";
import type { AvailabilityCell } from "@playstop/types";
import { CELL_STATES } from "@playstop/types";
import { isoInstantSchema, objectIdSchema } from "../primitives/index.js";

export const cellStateSchema = z.nativeEnum(CELL_STATES);

export const availabilityCellSchema = z.object({
  stationId: objectIdSchema,
  startsAt: isoInstantSchema,
  endsAt: isoInstantSchema,
  localLabel: z.string(),
  state: cellStateSchema,
}) satisfies z.ZodType<AvailabilityCell>;