import { ObjectId } from "mongodb";
import { collections, connectMongo, mongoClient } from "#libs/mongo/index.js";
import { createIndexes } from "#libs/mongo/indexes.js";
import type { OpeningHours, StationDoc } from "#libs/mongo/index.js";

const GRID_MINUTES = 30;

function allWeek(open: string, close: string): OpeningHours {
  const day = { open, close };
  return { "0": day, "1": day, "2": day, "3": day, "4": day, "5": day, "6": day };
}

interface StationSeed {
  slugPrefix: string;
  label: string;
  kind: StationDoc["kind"];
  count: number;
  capacity: number;
  hourlyRateMinor: number; // must satisfy (rate * GRID_MINUTES) % 60 === 0
  minSlots: number;
  maxSlots: number;
}

// 7 x PS5, 3 x PS3, 2 x PS2, 3 x racing sim, 15 total. Rates are flat
// hourly per station (section 11: no peak pricing in this milestone).
const STATION_KINDS: readonly StationSeed[] = [
  { slugPrefix: "ps5", label: "PS5", kind: "ps5", count: 7, capacity: 4, hourlyRateMinor: 15_000, minSlots: 1, maxSlots: 8 },
  { slugPrefix: "ps3", label: "PS3", kind: "ps3", count: 3, capacity: 3, hourlyRateMinor: 10_000, minSlots: 1, maxSlots: 8 },
  { slugPrefix: "ps2", label: "PS2", kind: "ps2", count: 2, capacity: 2, hourlyRateMinor: 8_000, minSlots: 1, maxSlots: 8 },
  { slugPrefix: "sim", label: "Sim Rig", kind: "racing-sim", count: 3, capacity: 4, hourlyRateMinor: 20_000, minSlots: 1, maxSlots: 6 },
];

type StationInput = Omit<StationDoc, "_id" | "venueId" | "createdAt" | "status" | "maintenanceWindows">;

function buildStationInputs(): StationInput[] {
  const stations: StationInput[] = [];
  for (const kind of STATION_KINDS) {
    if ((kind.hourlyRateMinor * GRID_MINUTES) % 60 !== 0) {
      throw new Error(
        `hourlyRateMinor ${kind.hourlyRateMinor} for kind "${kind.kind}" does not divide evenly ` +
          `into ${GRID_MINUTES}-minute cells; every cell price must be an exact integer of minor units`,
      );
    }
    for (let i = 1; i <= kind.count; i++) {
      stations.push({
        slug: `${kind.slugPrefix}-${i}`,
        name: `${kind.label} #${i}`,
        kind: kind.kind,
        capacity: kind.capacity,
        hourlyRateMinor: kind.hourlyRateMinor,
        minSlots: kind.minSlots,
        maxSlots: kind.maxSlots,
      });
    }
  }
  return stations;
}

interface VenueSeed {
  slug: string;
  name: string;
  timezone: string;
  openingHours: OpeningHours;
  bufferMinutes: number;
  currency: string;
  leadTimeMinutes: number;
  maxAdvanceDays: number;
  blackoutDates: string[];
}

const MAIN_VENUE: VenueSeed = {
  slug: "playstop-indiranagar",
  name: "PlayStop Indiranagar",
  timezone: "Asia/Kolkata",
  // 14:00 to 02:00: exercises the midnight-crossing path in manual
  // testing, not only in unit tests.
  openingHours: allWeek("14:00", "02:00"),
  bufferMinutes: 0,
  currency: "INR",
  leadTimeMinutes: 30,
  maxAdvanceDays: 14,
  blackoutDates: [],
};

// Behind --with-dst-venue only, so DST can be poked at by hand as well as
// in unit tests. No stations: this venue exists to exercise the grid, not
// the booking flow.
const DST_VENUE: VenueSeed = {
  slug: "playstop-dst-test",
  name: "PlayStop DST Test (New York)",
  timezone: "America/New_York",
  openingHours: allWeek("14:00", "02:00"),
  bufferMinutes: 0,
  currency: "USD",
  leadTimeMinutes: 30,
  maxAdvanceDays: 14,
  blackoutDates: [],
};

// Upsert on slug, idempotent by construction.
async function upsertVenue(seed: VenueSeed): Promise<ObjectId> {
  const now = new Date();
  const venue = await collections.venues().findOneAndUpdate(
    { slug: seed.slug },
    {
      $set: {
        name: seed.name,
        timezone: seed.timezone,
        gridMinutes: GRID_MINUTES,
        bufferMinutes: seed.bufferMinutes,
        currency: seed.currency,
        openingHours: seed.openingHours,
        blackoutDates: seed.blackoutDates,
        leadTimeMinutes: seed.leadTimeMinutes,
        maxAdvanceDays: seed.maxAdvanceDays,
      },
      $setOnInsert: { slug: seed.slug, createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!venue) throw new Error(`Failed to upsert venue "${seed.slug}"`);
  return venue._id;
}

// Upsert on (venueId, slug), idempotent by construction.
async function upsertStation(venueId: ObjectId, input: StationInput): Promise<void> {
  const now = new Date();
  await collections.stations().findOneAndUpdate(
    { venueId, slug: input.slug },
    {
      $set: {
        name: input.name,
        kind: input.kind,
        status: "active",
        capacity: input.capacity,
        hourlyRateMinor: input.hourlyRateMinor,
        minSlots: input.minSlots,
        maxSlots: input.maxSlots,
      },
      $setOnInsert: { venueId, slug: input.slug, maintenanceWindows: [], createdAt: now },
    },
    { upsert: true },
  );
}

async function seedVenueWithStations(seed: VenueSeed, stationInputs: StationInput[]): Promise<void> {
  const venueId = await upsertVenue(seed);
  for (const input of stationInputs) {
    await upsertStation(venueId, input);
  }
  const stationCount = await collections.stations().countDocuments({ venueId });
  console.log(`seeded "${seed.slug}": ${stationCount} station(s)`);
}

async function main(): Promise<void> {
  const withDstVenue = process.argv.includes("--with-dst-venue");

  await connectMongo();
  await createIndexes();

  const stationInputs = buildStationInputs();
  await seedVenueWithStations(MAIN_VENUE, stationInputs);

  if (withDstVenue) {
    await seedVenueWithStations(DST_VENUE, []);
  }

  await mongoClient().close();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
