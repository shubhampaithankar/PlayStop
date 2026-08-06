import { z } from "zod";
import { isoInstantSchema, objectIdSchema } from "./primitives.js";

export const cellStateSchema = z.enum([
  "free",
  "held",
  "booked",
  "maintenance",
  "past",
  "too_far_ahead",
]);

export type CellState = z.infer<typeof cellStateSchema>;

export const availabilityCellSchema = z.object({
  stationId: objectIdSchema,
  startsAt: isoInstantSchema, // THE IDENTITY, send this back verbatim
  endsAt: isoInstantSchema,
  localLabel: z.string(), // display only, never sent back
  state: cellStateSchema,
});

export type AvailabilityCell = z.infer<typeof availabilityCellSchema>;
