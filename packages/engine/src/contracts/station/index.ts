import { z } from "zod";
import type { StationKind } from "@playstop/types";
import { objectIdSchema } from "../primitives/index.js";

// The four values are declared exactly once, in packages/types' hand-written
// StationKind union (also used by StationDoc and StationInput). `satisfies`
// fails the build the moment this array drifts from that union.
const stationKinds = ["ps5", "ps3", "ps2", "racing-sim"] as const satisfies readonly StationKind[];

export const stationKindSchema = z.enum(stationKinds);

export const stationSummarySchema = z.object({
  id: objectIdSchema,
  slug: z.string(),
  name: z.string(),
  kind: stationKindSchema,
  capacity: z.number().int(), // max partySize
  hourlyRateMinor: z.number().int(), // integer minor units of the venue's currency
  minSlots: z.number().int(),
  maxSlots: z.number().int(),
});

export type StationSummary = z.infer<typeof stationSummarySchema>;
