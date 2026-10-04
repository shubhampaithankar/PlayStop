import type { ObjectId } from "mongodb";
import type { StationKind } from "../station-kind/index.js";
import type { BookingStatus } from "../booking-status/index.js";

export type Weekday = "0" | "1" | "2" | "3" | "4" | "5" | "6";

export interface OpeningHoursDay {
  readonly open: string;
  readonly close: string;
}

export type OpeningHours = Readonly<Record<Weekday, OpeningHoursDay | null>>;

export interface VenueDoc {
  _id: ObjectId;
  slug: string;
  name: string;
  timezone: string;
  gridMinutes: number;
  bufferMinutes: number;
  currency: string;
  openingHours: OpeningHours;
  blackoutDates: string[];
  leadTimeMinutes: number;
  maxAdvanceDays: number;
  createdAt: Date;
}

export type StationStatus = "active" | "retired";

export interface MaintenanceWindow {
  startsAt: Date;
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
  hourlyRateMinor: number;
  minSlots: number;
  maxSlots: number;
  maintenanceWindows: MaintenanceWindow[];
  createdAt: Date;
}

export interface BookingPlayer {
  name: string;
  email?: string;
  phone?: string;
}

export interface BookingDoc {
  _id: ObjectId;
  venueId: ObjectId;
  stationId: ObjectId;
  startsAt: Date;
  endsAt: Date;
  slotCount: number;
  bufferSlotCount: number;
  partySize: number;
  status: BookingStatus;
  confirmationCode: string;
  totalMinor: number;
  currency: string;
  player: BookingPlayer;
  contactChannel: "email" | "sms";
  contact: string;
  idempotencyKey: string;
  createdAt: Date;
  cancelledAt: Date | null;
  confirmationSentAt: Date | null;
  cancellationSentAt: Date | null;
  nudgeSentAt: Date | null;
}

export type ClaimKind = "play" | "buffer";
export type ClaimStatus = "confirmed" | "cancelled";

export interface SlotClaimDoc {
  _id: ObjectId;
  venueId: ObjectId;
  stationId: ObjectId;
  bookingId: ObjectId;
  cellStart: Date;
  kind: ClaimKind;
  status: ClaimStatus;
  createdAt: Date;
}

export type IdempotencyState = "in_flight" | "completed" | "failed";

export interface IdempotencyDoc {
  _id: string;
  venueId: ObjectId;
  key: string;
  requestHash: string;
  state: IdempotencyState;
  statusCode?: number;
  response?: unknown;
  bookingId?: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}
