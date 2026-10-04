import type { BookingResponse } from "@playstop/engine";
import type { BookingDoc, SlotClaimDoc } from "#libs/mongo/index.js";

export interface BuiltConfirmDocs {
  readonly bookingDoc: BookingDoc;
  readonly claimDocs: SlotClaimDoc[];
  readonly responseBody: BookingResponse;
}

export type IdempotencyClaim =
  | { readonly outcome: "claimed"; readonly id: string }
  | { readonly outcome: "replay"; readonly statusCode: number; readonly response: unknown };

export type BookingResponseSource = Omit<
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
