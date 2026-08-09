import { z } from "zod";
import type { AvailabilityCell, CellState } from "@playstop/types";
import { isoInstantSchema, objectIdSchema } from "./primitives.js";

// The six values are declared exactly once, in packages/types' hand-written
// CellState union. `satisfies` fails the build the moment this array drifts
// from that union, replacing what used to be a runtime sync test.
const cellStates = [
  "free",
  "held",
  "booked",
  "maintenance",
  "past",
  "too_far_ahead",
] as const satisfies readonly CellState[];

export const cellStateSchema = z.enum(cellStates);

export const availabilityCellSchema = z.object({
  stationId: objectIdSchema,
  startsAt: isoInstantSchema, // THE IDENTITY, send this back verbatim
  endsAt: isoInstantSchema,
  localLabel: z.string(), // display only, never sent back
  state: cellStateSchema,
}) satisfies z.ZodType<AvailabilityCell>;
