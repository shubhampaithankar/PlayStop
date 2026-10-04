import { z } from "zod";
import { ERROR_CODES } from "./constants.js";

export { ERROR_CODES };

export const errorCodeSchema = z.nativeEnum(ERROR_CODES);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;