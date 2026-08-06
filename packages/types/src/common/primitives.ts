import { z } from "zod";

// Shared primitives, defined once so every schema that needs an ObjectId,
// a UTC instant, or a local business date agrees on the exact shape.

export const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/);

// Requiring the literal "Z" removes any chance of a client sending an
// offset like "-04:00" versus "-05:00" and the server having to guess
// which of two fall-back instants was meant. The identity is a UTC
// instant, so the wire format is UTC.
export const isoInstantSchema = z.string().datetime({ offset: false });

export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type ObjectIdString = z.infer<typeof objectIdSchema>;
export type IsoInstant = z.infer<typeof isoInstantSchema>;
export type LocalDate = z.infer<typeof localDateSchema>;
