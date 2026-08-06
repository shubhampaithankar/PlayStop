import { z } from "zod";
import { isoInstantSchema, objectIdSchema } from "../common/primitives.js";

export const createHoldRequestSchema = z.object({
  stationId: objectIdSchema,
  startsAt: isoInstantSchema,
  slotCount: z.number().int().min(1).max(48),
});

export type CreateHoldRequest = z.infer<typeof createHoldRequestSchema>;

export const createHoldResponseSchema = z.object({
  holdId: z.string().uuid(),
  stationId: objectIdSchema,
  startsAt: isoInstantSchema,
  endsAt: isoInstantSchema, // startsAt + slotCount * gridMinutes
  slotCount: z.number().int(),
  expiresAt: isoInstantSchema,
  ttlSeconds: z.number().int(),
  quoteMinor: z.number().int(), // informational; confirm recomputes and is authoritative
  currency: z.string(),
});

export type CreateHoldResponse = z.infer<typeof createHoldResponseSchema>;

export const releaseHoldRequestSchema = z.object({
  holdId: z.string().uuid(),
  stationId: objectIdSchema,
  startsAt: isoInstantSchema,
  slotCount: z.number().int().min(1).max(48),
});

export type ReleaseHoldRequest = z.infer<typeof releaseHoldRequestSchema>;
