import { z } from "zod";
import type { AvailabilityCell } from "@playstop/types";
import { isoInstantSchema, objectIdSchema } from "../primitives/index.js";
import { CELL_STATES } from "./constants.js";

export const cellStateSchema = z.nativeEnum(CELL_STATES);

export const availabilityCellSchema = z.object({
  stationId: objectIdSchema,
  startsAt: isoInstantSchema, // THE IDENTITY, send this back verbatim
  endsAt: isoInstantSchema,
  localLabel: z.string(), // display only, never sent back
  state: cellStateSchema,
}) satisfies z.ZodType<AvailabilityCell>;