import { MongoClient, ObjectId, type Collection, type Db } from "mongodb";
import { env } from "#env.js";

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

const client = new MongoClient(env.MONGODB_URI);
let db: Db | undefined;

export async function connectMongo(): Promise<void> {
  await client.connect();
  db = client.db(env.MONGODB_DB);
}

function requireDb(): Db {
  if (!db) {
    throw new Error("Mongo not connected: call connectMongo() during boot before using collections");
  }
  return db;
}

export const collections = {
  venues: (): Collection<VenueDoc> => requireDb().collection<VenueDoc>("venues"),
  stations: (): Collection<StationDoc> => requireDb().collection<StationDoc>("stations"),
  bookings: (): Collection<BookingDoc> => requireDb().collection<BookingDoc>("bookings"),
  slotClaims: (): Collection<SlotClaimDoc> => requireDb().collection<SlotClaimDoc>("slot_claims"),
  idempotency: (): Collection<IdempotencyDoc> => requireDb().collection<IdempotencyDoc>("idempotency"),
};

export function mongoClient(): MongoClient {
  return client;
}

// Shallow liveness ping for /health, and the mechanism that keeps Atlas's
// 30-day auto-pause from firing on an otherwise-idle keepalive.
export async function pingMongo(): Promise<void> {
  await requireDb().command({ ping: 1 });
}

// Every index from spec section 1, idempotent, run at boot before the HTTP
// listener starts. A running API without uniq_slot_claim is a correctness
// hazard, not a degraded mode, so boot must not proceed past a failure here.
export async function createIndexes(): Promise<void> {
  await collections.venues().createIndex({ slug: 1 }, { unique: true });

  await collections.stations().createIndex({ venueId: 1, status: 1 });
  await collections.stations().createIndex({ venueId: 1, slug: 1 }, { unique: true });

  // The correctness backstop. Key order (venueId, cellStart, stationId)
  // makes the availability window read a covered IXSCAN; see section 1.
  await collections.slotClaims().createIndex(
    { venueId: 1, cellStart: 1, stationId: 1 },
    { unique: true, partialFilterExpression: { status: "confirmed" }, name: "uniq_slot_claim" },
  );

  await collections
    .bookings()
    .createIndex({ venueId: 1, confirmationCode: 1 }, { unique: true, name: "uniq_booking_code" });

  // idempotency's _id is implicitly unique; only the TTL index is explicit.
  await collections.idempotency().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
