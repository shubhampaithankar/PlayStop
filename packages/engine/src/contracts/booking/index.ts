import { z } from "zod";
import { isoInstantSchema, objectIdSchema } from "../primitives/index.js";
import { SLOT_COUNT_MIN, SLOT_COUNT_MAX } from "../primitives/constants.js";
import { stationKindSchema } from "../station/index.js";
import {
  CONFIRMATION_CODE_PATTERN,
  PLAYER_NAME_MIN_LENGTH,
  PLAYER_NAME_MAX_LENGTH,
  PLAYER_PHONE_MIN_LENGTH,
  PLAYER_PHONE_MAX_LENGTH,
  PLAYER_PHONE_PATTERN,
  PARTY_SIZE_MIN,
  PARTY_SIZE_MAX,
  BOOKING_STATUSES,
} from "./constants.js";

const confirmationCodeSchema = z.string().regex(CONFIRMATION_CODE_PATTERN);

const playerSchema = z.object({
  name: z.string().trim().min(PLAYER_NAME_MIN_LENGTH).max(PLAYER_NAME_MAX_LENGTH),
  email: z.string().email().optional(),
  phone: z
    .string()
    .min(PLAYER_PHONE_MIN_LENGTH)
    .max(PLAYER_PHONE_MAX_LENGTH)
    .regex(PLAYER_PHONE_PATTERN)
    .optional(),
});

export const createBookingRequestSchema = z.object({
  stationId: objectIdSchema,
  startsAt: isoInstantSchema,
  slotCount: z.number().int().min(SLOT_COUNT_MIN).max(SLOT_COUNT_MAX),
  partySize: z.number().int().min(PARTY_SIZE_MIN).max(PARTY_SIZE_MAX),
  holdId: z.string().uuid().optional(),
  verificationId: z.string().uuid(),
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
  localLabel: z.string(),
  status: z.nativeEnum(BOOKING_STATUSES),
  confirmationCode: confirmationCodeSchema,
  totalMinor: z.number().int(),
  currency: z.string(),
  player: playerSchema,
  contactChannel: z.enum(["email", "sms"]).nullable(),
  contact: z.string().nullable(),
  createdAt: isoInstantSchema,
  cancelledAt: isoInstantSchema.nullable(),
  confirmationSentAt: isoInstantSchema.nullable(),
  cancellationSentAt: isoInstantSchema.nullable(),
  nudgeSentAt: isoInstantSchema.nullable(),
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

export const lookupBookingsRequestSchema = z.object({
  verificationId: z.string().uuid(),
});

export type LookupBookingsRequest = z.infer<typeof lookupBookingsRequestSchema>;

export const lookupBookingsResponseSchema = z.object({
  bookings: z.array(bookingResponseSchema),
});

export type LookupBookingsResponse = z.infer<typeof lookupBookingsResponseSchema>;
