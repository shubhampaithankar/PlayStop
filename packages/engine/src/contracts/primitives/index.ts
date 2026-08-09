import { z } from "zod";
import {
  OBJECT_ID_PATTERN,
  LOCAL_DATE_PATTERN,
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_KEY_MAX_LENGTH,
} from "./constants.js";

// Shared primitives, defined once so every schema that needs an ObjectId,
// a UTC instant, or a local business date agrees on the exact shape.

export const objectIdSchema = z.string().regex(OBJECT_ID_PATTERN);

// Requiring the literal "Z" removes any chance of a client sending an
// offset like "-04:00" versus "-05:00" and the server having to guess
// which of two fall-back instants was meant. The identity is a UTC
// instant, so the wire format is UTC.
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