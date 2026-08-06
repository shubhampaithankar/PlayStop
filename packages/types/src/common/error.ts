import { z } from "zod";

// Closed set, shared with the client, so apps/web gets an exhaustive union
// and the compiler catches an unhandled case when a new code is added.
export const errorCodeSchema = z.enum([
  "SLOT_TAKEN",
  "SLOT_HELD",
  "HOLD_EXPIRED",
  "VENUE_NOT_FOUND",
  "STATION_NOT_FOUND",
  "PARTY_SIZE_EXCEEDS_CAPACITY",
  "SLOT_COUNT_OUT_OF_RANGE",
  "IDEMPOTENCY_KEY_REUSED",
  "REQUEST_IN_FLIGHT",
  "IDEMPOTENCY_KEY_REQUIRED",
  "SLOT_NOT_ON_GRID",
  "SLOT_OUT_OF_WINDOW",
  "SLOT_UNAVAILABLE",
  "DATE_OUT_OF_RANGE",
  "BOOKING_NOT_CANCELLABLE",
  "HOLD_UNAVAILABLE",
  "BOOKING_TIMEOUT",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "BOOKING_NOT_FOUND",
  "NOT_FOUND", // generic 404 for a route that matches no endpoint at all
  "INTERNAL",
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(), // human-readable, safe to display
    details: z.unknown().optional(), // only populated for VALIDATION_FAILED and SLOT_TAKEN
    requestId: z.string(), // matches the X-Request-Id header
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
