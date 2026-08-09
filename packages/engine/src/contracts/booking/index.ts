import { z } from "zod";
import { isoInstantSchema, objectIdSchema } from "../primitives/index.js";
import { stationKindSchema } from "../station/index.js";

// Crockford base32, no ambiguous glyphs (I, L, O, U excluded).
const confirmationCodeSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/);

const playerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email().optional(),
  phone: z
    .string()
    .min(5)
    .max(32)
    .regex(/^[+0-9 ()-]+$/)
    .optional(),
});

export const createBookingRequestSchema = z.object({
  stationId: objectIdSchema,
  startsAt: isoInstantSchema, // must be a grid cell start
  slotCount: z.number().int().min(1).max(48), // station bound minSlots..maxSlots checked server-side
  partySize: z.number().int().min(1).max(8), // station bound 1..capacity checked server-side
  holdId: z.string().uuid().optional(), // absence is legal, see section 4
  player: playerSchema,
});

export type CreateBookingRequest = z.infer<typeof createBookingRequestSchema>;

export const bookingResponseSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  stationId: z.string(),
  stationName: z.string(),
  stationKind: stationKindSchema,
  startsAt: isoInstantSchema,
  endsAt: isoInstantSchema,
  slotCount: z.number().int(),
  partySize: z.number().int(),
  localLabel: z.string(), // label of the first cell
  status: z.enum(["confirmed", "cancelled"]),
  confirmationCode: confirmationCodeSchema,
  totalMinor: z.number().int(),
  currency: z.string(),
  player: playerSchema,
  createdAt: isoInstantSchema,
  cancelledAt: isoInstantSchema.nullable(),
});

export type BookingResponse = z.infer<typeof bookingResponseSchema>;

export const getBookingQuerySchema = z.object({
  code: confirmationCodeSchema,
});

export type GetBookingQuery = z.infer<typeof getBookingQuerySchema>;

export const cancelBookingRequestSchema = z.object({
  confirmationCode: confirmationCodeSchema,
});

export type CancelBookingRequest = z.infer<typeof cancelBookingRequestSchema>;
