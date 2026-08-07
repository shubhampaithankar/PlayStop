import type { ObjectId } from "mongodb";

// Mongo document shapes, per docs/milestone-2-spec.md section 1. These are
// the on-disk documents, not the wire contracts in @playstop/types: the
// spec keeps network schemas and Mongo documents deliberately separate.

export type Weekday = "0" | "1" | "2" | "3" | "4" | "5" | "6";

export interface OpeningHoursDay {
  readonly open: string; // "HH:MM" local wall-clock
  readonly close: string; // "HH:MM"; close <= open means the session crosses midnight
}

export type OpeningHours = Readonly<Record<Weekday, OpeningHoursDay | null>>;

export interface VenueDoc {
  _id: ObjectId;
  slug: string;
  name: string;
  timezone: string; // IANA
  gridMinutes: number;
  bufferMinutes: number;
  currency: string; // ISO 4217
  openingHours: OpeningHours;
  blackoutDates: string[]; // "YYYY-MM-DD", local business dates
  leadTimeMinutes: number;
  maxAdvanceDays: number;
  createdAt: Date;
}

export type StationKind = "ps5" | "ps3" | "ps2" | "racing-sim";
export type StationStatus = "active" | "retired";

export interface MaintenanceWindow {
  startsAt: Date; // UTC instant, half-open [start, end)
  endsAt: Date;
}

export interface StationDoc {
  _id: ObjectId;
  venueId: ObjectId;
  slug: string;
  name: string;
  kind: StationKind;
  status: StationStatus;
  capacity: number;
  hourlyRateMinor: number; // integer minor units of the venue's currency
  minSlots: number;
  maxSlots: number;
  maintenanceWindows: MaintenanceWindow[];
  createdAt: Date;
}

export type BookingStatus = "confirmed" | "cancelled";

export interface BookingPlayer {
  name: string;
  email?: string;
  phone?: string;
}

export interface BookingDoc {
  _id: ObjectId;
  venueId: ObjectId;
  stationId: ObjectId;
  startsAt: Date; // UTC instant, first play cell's start
  endsAt: Date; // startsAt + slotCount * gridMinutes, exclusive, play only
  slotCount: number;
  bufferSlotCount: number;
  partySize: number;
  status: BookingStatus;
  confirmationCode: string; // 10-char Crockford base32
  totalMinor: number;
  currency: string;
  player: BookingPlayer;
  idempotencyKey: string;
  createdAt: Date;
  cancelledAt: Date | null;
}

export type ClaimKind = "play" | "buffer";
export type ClaimStatus = "confirmed" | "cancelled";

export interface SlotClaimDoc {
  _id: ObjectId;
  venueId: ObjectId;
  stationId: ObjectId;
  bookingId: ObjectId;
  cellStart: Date; // UTC instant, aligned to the venue grid: CELL IDENTITY
  kind: ClaimKind;
  status: ClaimStatus;
  createdAt: Date;
}

export type IdempotencyState = "in_flight" | "completed" | "failed";

export interface IdempotencyDoc {
  _id: string; // `${venueId}:${idempotencyKey}`
  venueId: ObjectId;
  key: string;
  requestHash: string; // sha256 hex of canonical JSON of the validated body
  state: IdempotencyState;
  statusCode?: number;
  response?: unknown;
  bookingId?: ObjectId;
  createdAt: Date;
  expiresAt: Date; // createdAt + 24h
}
