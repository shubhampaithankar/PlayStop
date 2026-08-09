// Shared test helpers for the low-volume integration layer (spec section 9,
// layer 2). Not itself a test file: node --test's default glob only picks
// up *.test.js, so this file is never run as a suite.
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { DateTime } from "luxon";
import { ObjectId } from "mongodb";
import { generateSlotGrid, type VenueSchedule } from "@playstop/engine";
import { collections, connectMongo, mongoClient, type OpeningHours, type StationDoc } from "#libs/mongo/index.js";
import { createIndexes } from "#libs/mongo/indexes.js";
import { env } from "#env.js";
import { redis, waitForRedisReady } from "#libs/redis/index.js";
import { buildApp } from "#app.js";

// The concurrency proof gate (spec section 9, layer 3): a fresh
// process.env read at import time, so a developer running `pnpm test`
// gets these files skipped rather than a throttled Atlas cluster. CI sets
// TEST_PROFILE=ci.
export const CI_ONLY = process.env.TEST_PROFILE === "ci";

// If CI silently drops TEST_PROFILE=ci (a typo in ci.yml, the env block
// moving off the `pnpm test` step), CI_ONLY goes false and all 8 gated
// concurrency tests are skipped without turning the run red. Fail loudly
// instead of trusting a green run to mean the gate fired. CI is unset
// locally, so this never fires outside CI.
if (process.env.CI && !CI_ONLY) {
  throw new Error(
    "CI is set but TEST_PROFILE is not 'ci' -- the concurrency proof gate would be silently skipped",
  );
}

let mongoReady: Promise<void> | undefined;

export function ensureMongoReady(): Promise<void> {
  mongoReady ??= connectMongo().then(() => createIndexes());
  return mongoReady;
}

export function allWeek(open: string, close: string): OpeningHours {
  const day = { open, close };
  return { "0": day, "1": day, "2": day, "3": day, "4": day, "5": day, "6": day };
}

export interface TestVenue {
  readonly venueId: ObjectId;
  readonly slug: string;
  readonly stationIds: ObjectId[];
  readonly schedule: VenueSchedule & { leadTimeMinutes: number; maxAdvanceDays: number };
}

export interface SeedVenueOptions {
  readonly timezone?: string;
  readonly openingHours?: OpeningHours;
  readonly bufferMinutes?: number;
  readonly leadTimeMinutes?: number;
  readonly maxAdvanceDays?: number;
  readonly blackoutDates?: string[];
  readonly stationCount?: number;
  readonly capacity?: number;
  readonly hourlyRateMinor?: number;
  readonly minSlots?: number;
  readonly maxSlots?: number;
}

// Tenant isolation IS the test isolation strategy (spec section 9): every
// test file seeds its own venue under a unique slug, and teardown deletes
// by venueId. Never a fresh database, never dropDatabase().
export async function seedVenue(opts: SeedVenueOptions = {}): Promise<TestVenue> {
  await ensureMongoReady();
  const slug = `test-${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const timezone = opts.timezone ?? "Asia/Kolkata";
  const openingHours = opts.openingHours ?? allWeek("14:00", "02:00");
  const leadTimeMinutes = opts.leadTimeMinutes ?? 0;
  // Tests spread bookings across many distinct future days (futureSessionCells
  // below) so sequential subtests never collide on the same cell; a generous
  // default keeps that well inside the window regardless of how many
  // subtests one file runs.
  const maxAdvanceDays = opts.maxAdvanceDays ?? 60;
  const bufferMinutes = opts.bufferMinutes ?? 0;
  const blackoutDates = opts.blackoutDates ?? [];

  const venueId = new ObjectId();
  await collections.venues().insertOne({
    _id: venueId,
    slug,
    name: `Test Venue ${slug}`,
    timezone,
    gridMinutes: 30,
    bufferMinutes,
    currency: "INR",
    openingHours,
    blackoutDates,
    leadTimeMinutes,
    maxAdvanceDays,
    createdAt: now,
  });

  const stationCount = opts.stationCount ?? 1;
  const stationIds: ObjectId[] = [];
  for (let i = 0; i < stationCount; i++) {
    const stationId = new ObjectId();
    const station: StationDoc = {
      _id: stationId,
      venueId,
      slug: `station-${i + 1}`,
      name: `Station ${i + 1}`,
      kind: "ps5",
      status: "active",
      capacity: opts.capacity ?? 4,
      hourlyRateMinor: opts.hourlyRateMinor ?? 1200,
      minSlots: opts.minSlots ?? 1,
      maxSlots: opts.maxSlots ?? 8,
      maintenanceWindows: [],
      createdAt: now,
    };
    await collections.stations().insertOne(station);
    stationIds.push(stationId);
  }

  return {
    venueId,
    slug,
    stationIds,
    schedule: { timezone, gridMinutes: 30, bufferMinutes, openingHours, blackoutDates, leadTimeMinutes, maxAdvanceDays },
  };
}

// Never dropDatabase(), never an unfiltered deleteMany({}): every delete
// here is scoped to one venueId.
export async function wipeVenue(venueId: ObjectId): Promise<void> {
  await Promise.all([
    collections.venues().deleteMany({ _id: venueId }),
    collections.stations().deleteMany({ venueId }),
    collections.bookings().deleteMany({ venueId }),
    collections.slotClaims().deleteMany({ venueId }),
    collections.idempotency().deleteMany({ venueId }),
  ]);
  await wipeVenueHolds(venueId);
}

async function wipeVenueHolds(venueId: ObjectId): Promise<void> {
  try {
    await waitForRedisReady(2000);
  } catch {
    return; // Redis down: nothing to wipe, TTL is the backstop anyway.
  }
  const pattern = `ps:${env.APP_ENV}:${venueId.toHexString()}:hold:*`;
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
}

// Each call advances to a fresh future business day, per venue, so
// sequential subtests booking cells on the same station never collide with
// each other's leftover claims/holds. A per-venue counter (not a single
// module-level one) keeps unrelated venues in the same file independent.
const dayOffsetByVenue = new WeakMap<TestVenue, number>();

/** The first `count` play cells of a session on a not-yet-used future local calendar day for this venue, so every cell is guaranteed both free and in the future. */
export function futureSessionCells(venue: TestVenue, count: number): { businessDate: string; cellStartMs: number[] } {
  const dayOffset = (dayOffsetByVenue.get(venue) ?? 0) + 1;
  dayOffsetByVenue.set(venue, dayOffset);
  const businessDate = DateTime.now().setZone(venue.schedule.timezone).plus({ days: dayOffset }).toISODate();
  if (!businessDate) throw new Error("could not resolve a future local date");
  const grid = generateSlotGrid(venue.schedule, businessDate);
  if (grid.kind !== "open") throw new Error(`test venue closed on ${businessDate}: ${grid.reason}`);
  if (grid.cells.length < count) throw new Error("not enough cells in test session");
  return { businessDate, cellStartMs: grid.cells.slice(0, count).map((c) => c.cellStartMs) };
}

export interface BurstResult {
  readonly results: PromiseSettledResult<Response>[];
  readonly startSpreadMs: number;
}

/**
 * Fires n HTTP requests as close to simultaneously as possible, for the
 * concurrency proof (spec section 9). buildRequest is called and its fetch
 * dispatched synchronously for every index in one tick, before any of them
 * is awaited, so this genuinely overlaps requests rather than serializing
 * them the way a `for` loop with `await fetch()` inside would.
 *
 * startSpreadMs is the proof: it is the gap between the first and last
 * dispatch timestamp, taken right before each fetch() call. A loop that
 * accidentally awaits between requests would spread dispatch across the
 * full per-request latency (tens of ms times n); a real burst keeps it
 * near zero.
 */
export async function fireBurst(
  n: number,
  buildRequest: (i: number) => { url: string; init: RequestInit },
): Promise<BurstResult> {
  const starts: number[] = new Array(n);
  const tasks = Array.from({ length: n }, (_, i) => {
    const { url, init } = buildRequest(i);
    starts[i] = performance.now();
    return fetch(url, init);
  });
  const results = await Promise.allSettled(tasks);
  const startSpreadMs = Math.max(...starts) - Math.min(...starts);
  return { results, startSpreadMs };
}

export interface TestServer {
  readonly baseUrl: string;
  readonly app: Express;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  await ensureMongoReady();
  const app = buildApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo | null;
  if (!address) throw new Error("expected an AddressInfo after listening");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    app,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

// node --test keeps a file alive until its event loop drains. The Mongo
// connection pool and the ioredis socket are both module-level and
// long-lived, so without this a fully green test file still hangs until the
// runner's timeout fires and reports a false failure. Call once per file,
// after the last assertion.
export async function closeTestResources(): Promise<void> {
  mongoReady = undefined;
  await mongoClient().close();
  redis.disconnect();
}

// Every test file's outer try/finally calls this. venue and server are
// optional because setup can throw before either is assigned -- reading
// .venueId or .close() off that unassigned value in a plain finally block
// throws a TypeError that masks the real setup error, and skips
// closeTestResources(), which is what stops the file hanging on a dangling
// ioredis client. Each step is isolated so one failing step (including a
// setup failure itself) never blocks the others, and closeTestResources()
// always runs last regardless of what happened above it.
export async function teardown(
  venue: Pick<TestVenue, "venueId"> | undefined,
  server: Pick<TestServer, "close"> | undefined,
): Promise<void> {
  if (venue) {
    try {
      await wipeVenue(venue.venueId);
    } catch (err) {
      console.warn("teardown: wipeVenue failed", err);
    }
  }
  if (server) {
    try {
      await server.close();
    } catch (err) {
      console.warn("teardown: server.close failed", err);
    }
  }
  try {
    await closeTestResources();
  } catch (err) {
    console.warn("teardown: closeTestResources failed", err);
  }
}
