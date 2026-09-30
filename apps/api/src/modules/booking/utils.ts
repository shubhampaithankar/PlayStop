import { randomBytes } from "node:crypto";
import type { BookingResponse, CreateBookingRequest } from "@playstop/engine";
import type { BookingDoc } from "#libs/mongo/index.js";
import { localLabelOf } from "#modules/venue/utils.js";

// Crockford base32, no ambiguous glyphs (I, L, O, U excluded), matching
// packages/types' confirmationCodeSchema regex exactly. 32 symbols, so
// byte % 32 has no modulo bias over a 256-value byte.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateConfirmationCode(): string {
  return confirmationCodeFromBytes(randomBytes(10));
}

// Split out so the seed can derive a deterministic code from a hash.
export function confirmationCodeFromBytes(bytes: Uint8Array): string {
  let code = "";
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}

// contactChannel/contact are typed optional here, not as BookingDoc has
// them (required): Mongo does not enforce the TS shape, and a booking
// written before the OTP milestone has neither field at all. Every new
// write always sets both (booking/controller.ts) -- this widening only
// ever matters for a legacy document read back off the shared Atlas.
type BookingResponseSource = Omit<
  Pick<
    BookingDoc,
    | "_id"
    | "venueId"
    | "stationId"
    | "startsAt"
    | "endsAt"
    | "slotCount"
    | "partySize"
    | "status"
    | "confirmationCode"
    | "totalMinor"
    | "currency"
    | "player"
    | "contactChannel"
    | "contact"
    | "createdAt"
    | "cancelledAt"
    | "confirmationSentAt"
    | "cancellationSentAt"
    | "nudgeSentAt"
  >,
  "contactChannel" | "contact"
> & {
  readonly contactChannel?: BookingDoc["contactChannel"];
  readonly contact?: BookingDoc["contact"];
};

export function toBookingResponse(
  booking: BookingResponseSource,
  stationName: string,
  stationKind: BookingResponse["stationKind"],
  timezone: string,
): BookingResponse {
  return {
    id: booking._id.toHexString(),
    venueId: booking.venueId.toHexString(),
    stationId: booking.stationId.toHexString(),
    stationName,
    stationKind,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    slotCount: booking.slotCount,
    partySize: booking.partySize,
    localLabel: localLabelOf(booking.startsAt.getTime(), timezone),
    status: booking.status,
    confirmationCode: booking.confirmationCode,
    totalMinor: booking.totalMinor,
    currency: booking.currency,
    player: booking.player,
    contactChannel: booking.contactChannel ?? null,
    contact: booking.contact ?? null,
    createdAt: booking.createdAt.toISOString(),
    cancelledAt: booking.cancelledAt ? booking.cancelledAt.toISOString() : null,
    confirmationSentAt: booking.confirmationSentAt ? booking.confirmationSentAt.toISOString() : null,
    cancellationSentAt: booking.cancellationSentAt ? booking.cancellationSentAt.toISOString() : null,
    nudgeSentAt: booking.nudgeSentAt ? booking.nudgeSentAt.toISOString() : null,
  };
}

// Zod's .optional() infers `T | undefined`, which exactOptionalPropertyTypes
// rejects when assigned directly onto BookingPlayer's `email?: string`
// (present-with-undefined is a different thing than absent). Build the
// document field by omission instead of ever storing an explicit undefined.
export function toBookingPlayer(player: CreateBookingRequest["player"]): BookingDoc["player"] {
  const result: BookingDoc["player"] = { name: player.name };
  if (player.email !== undefined) result.email = player.email;
  if (player.phone !== undefined) result.phone = player.phone;
  return result;
}
