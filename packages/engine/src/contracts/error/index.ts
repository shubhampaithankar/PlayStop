import { z } from "zod";
import { ERROR_CODES } from "./constants.js";

export const errorCodeSchema = z.nativeEnum(ERROR_CODES);

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