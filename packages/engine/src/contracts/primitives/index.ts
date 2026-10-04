import { z } from "zod";
import {
  OBJECT_ID_PATTERN,
  LOCAL_DATE_PATTERN,
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_KEY_MAX_LENGTH,
} from "./constants.js";

export const objectIdSchema = z.string().regex(OBJECT_ID_PATTERN);

export const isoInstantSchema = z.string().datetime({ offset: false });

export const localDateSchema = z.string().regex(LOCAL_DATE_PATTERN);

export const idempotencyKeySchema = z
  .string()
  .min(IDEMPOTENCY_KEY_MIN_LENGTH)
  .max(IDEMPOTENCY_KEY_MAX_LENGTH)
  .regex(IDEMPOTENCY_KEY_PATTERN);

export type ObjectIdString = z.infer<typeof objectIdSchema>;
export type IsoInstant = z.infer<typeof isoInstantSchema>;
export type LocalDate = z.infer<typeof localDateSchema>;
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;