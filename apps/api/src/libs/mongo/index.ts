import { MongoClient, type Collection, type Db } from "mongodb";
import { env } from "#env.js";
import type { VenueDoc, StationDoc, BookingDoc, SlotClaimDoc, IdempotencyDoc } from "./types.js";

export * from "./types.js";

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
