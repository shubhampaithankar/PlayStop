import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { ObjectId } from "mongodb";
import { buildClaimCells, generateSlotGrid, priceBooking } from "@playstop/engine";
import { collections, connectMongo, mongoClient } from "#libs/mongo/index.js";
import { createIndexes } from "#libs/mongo/indexes.js";
import type { BookingDoc, OpeningHours, SlotClaimDoc, StationDoc } from "#libs/mongo/index.js";
import { confirmationCodeFromBytes } from "#modules/booking/utils.js";
import { venueScheduleOf } from "#modules/venue/utils.js";

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
  { slugPrefix: "ps5", label: "PS5", kind: "ps5", count: 7, capacity: 4, hourlyRateMinor: 15_000, minSlots: 2, maxSlots: 8 },
  { slugPrefix: "ps3", label: "PS3", kind: "ps3", count: 3, capacity: 3, hourlyRateMinor: 10_000, minSlots: 2, maxSlots: 8 },
  { slugPrefix: "ps2", label: "PS2", kind: "ps2", count: 2, capacity: 2, hourlyRateMinor: 8_000, minSlots: 2, maxSlots: 8 },
  { slugPrefix: "sim", label: "Sim Rig", kind: "racing-sim", count: 3, capacity: 4, hourlyRateMinor: 20_000, minSlots: 2, maxSlots: 6 },
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
  slug: "playstop-laxminagar",
  name: "PlayStop Laxminagar",
  timezone: "Asia/Kolkata",
  // 14:00 to 02:00: exercises the midnight-crossing path in manual
  // testing, not only in unit tests.
  openingHours: allWeek("14:00", "02:00"),
  bufferMinutes: 0,
  currency: "INR",
  leadTimeMinutes: 30,
  maxAdvanceDays: 6,
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
  maxAdvanceDays: 6,
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

// ---------------------------------------------------------------------------
// Demo availability states. Anchored to "today" in the venue timezone on every
// run, so a reseed always lands in the running week. Bookings go through the
// same shape and the same all-or-nothing transaction as createBooking, so the
// uniq_slot_claim index stays the arbiter: this never bypasses it.
// ---------------------------------------------------------------------------

// Station that is retired: renders as the "unavailable" ghost card.
const DEMO_RETIRED_SLUG = "ps3-3";
// Station with a maintenance window tomorrow evening: "being fixed" cells.
const DEMO_MAINTENANCE = { slug: "ps5-3", dayOffset: 1, firstCellIndex: 12, cellCount: 6 };

interface DemoBookingRange {
  stationSlug: string;
  dayOffset: number; // 0 = today's business date, 1 = tomorrow
  firstCellIndex: number; // index into that day's grid (0 = opening)
  cellCount: number; // split into bookings of at most station.maxSlots
}

// 24 cells in a 14:00 to 02:00 day. ps2-1 is full tomorrow (booked_out);
// ps2-2 is full except the last two cells (free_from 01:00 = near-full).
const DEMO_BOOKING_RANGES: readonly DemoBookingRange[] = [
  { stationSlug: "ps5-1", dayOffset: 0, firstCellIndex: 10, cellCount: 4 },
  { stationSlug: "ps5-2", dayOffset: 0, firstCellIndex: 10, cellCount: 3 },
  { stationSlug: "ps5-1", dayOffset: 1, firstCellIndex: 12, cellCount: 4 },
  { stationSlug: "ps2-1", dayOffset: 1, firstCellIndex: 0, cellCount: 24 },
  { stationSlug: "ps2-2", dayOffset: 1, firstCellIndex: 0, cellCount: 22 },
];

// Same alphabet and length as generateConfirmationCode, but derived from the
// slot so a reseed finds the booking it already made.
function demoConfirmationCode(stationSlug: string, startsAtIso: string): string {
  return confirmationCodeFromBytes(createHash("sha256").update(`${stationSlug}|${startsAtIso}`).digest().subarray(0, 10));
}

async function seedDemoData(venueId: ObjectId): Promise<void> {
  const venue = await collections.venues().findOne({ _id: venueId });
  if (!venue) throw new Error("venue vanished before demo seeding");
  const schedule = venueScheduleOf(venue);
  const stations = await collections.stations().find({ venueId }).toArray();
  const stationBySlug = new Map(stations.map((station) => [station.slug, station]));

  const today = DateTime.now().setZone(venue.timezone).startOf("day");
  // ponytail: before 02:00 local, "today" is a day ahead of the session still
  // open. Fine for demo data (seeded rows are simply a few cells later).
  const gridOf = (dayOffset: number) => {
    const grid = generateSlotGrid(schedule, today.plus({ days: dayOffset }).toFormat("yyyy-MM-dd"));
    if (grid.kind !== "open") throw new Error(`venue is closed on demo day +${dayOffset}`);
    return grid;
  };

  // Retired station (ghost card) and maintenance window (being-fixed cells).
  // Always re-set, so a reseed moves the window into the current week.
  await collections
    .stations()
    .updateOne({ venueId, slug: DEMO_RETIRED_SLUG }, { $set: { status: "retired" } });
  const maintenanceCells = gridOf(DEMO_MAINTENANCE.dayOffset).cells.slice(
    DEMO_MAINTENANCE.firstCellIndex,
    DEMO_MAINTENANCE.firstCellIndex + DEMO_MAINTENANCE.cellCount,
  );
  const lastMaintenanceCell = maintenanceCells[maintenanceCells.length - 1];
  const firstMaintenanceCell = maintenanceCells[0];
  if (!firstMaintenanceCell || !lastMaintenanceCell) throw new Error("maintenance window falls outside the grid");
  await collections.stations().updateOne(
    { venueId, slug: DEMO_MAINTENANCE.slug },
    {
      $set: {
        maintenanceWindows: [
          { startsAt: new Date(firstMaintenanceCell.cellStartMs), endsAt: new Date(lastMaintenanceCell.cellEndMs) },
        ],
      },
    },
  );

  let created = 0;
  let alreadySeeded = 0;
  const session = mongoClient().startSession();
  try {
    for (const range of DEMO_BOOKING_RANGES) {
      const station = stationBySlug.get(range.stationSlug);
      if (!station) throw new Error(`demo booking references unknown station "${range.stationSlug}"`);
      const grid = gridOf(range.dayOffset);

      for (let offset = 0; offset < range.cellCount; offset += station.maxSlots) {
        const slotCount = Math.min(station.maxSlots, range.cellCount - offset);
        const startCell = grid.cells[range.firstCellIndex + offset];
        if (!startCell) throw new Error(`demo range for "${range.stationSlug}" runs past the grid`);
        const { playMs, bufferMs } = buildClaimCells(grid.cells, startCell.cellStartMs, slotCount, 0);
        const startsAtIso = new Date(startCell.cellStartMs).toISOString();
        const confirmationCode = demoConfirmationCode(station.slug, startsAtIso);

        if (await collections.bookings().findOne({ venueId, confirmationCode })) {
          alreadySeeded++;
          continue;
        }

        const now = new Date();
        const bookingId = new ObjectId();
        const bookingDoc: BookingDoc = {
          _id: bookingId,
          venueId,
          stationId: station._id,
          startsAt: new Date(startCell.cellStartMs),
          endsAt: new Date(startCell.cellStartMs + slotCount * venue.gridMinutes * 60_000),
          slotCount,
          bufferSlotCount: 0, // ponytail: MAIN_VENUE bufferMinutes is 0; buildClaimCells would return bufferMs otherwise
          partySize: 2,
          status: "confirmed",
          confirmationCode,
          totalMinor: priceBooking(station, venue.gridMinutes, slotCount),
          currency: venue.currency,
          player: { name: "Demo Guest" },
          contactChannel: "email",
          contact: "demo-guest@playstop.invalid",
          idempotencyKey: `demo-seed-${station.slug}-${startsAtIso}`,
          createdAt: now,
          cancelledAt: null,
          confirmationSentAt: null,
          cancellationSentAt: null,
          nudgeSentAt: null,
        };
        const claimDocs: SlotClaimDoc[] = [
          ...playMs.map((ms) => ({ ms, kind: "play" as const })),
          ...bufferMs.map((ms) => ({ ms, kind: "buffer" as const })),
        ].map(({ ms, kind }) => ({
          _id: new ObjectId(),
          venueId,
          stationId: station._id,
          bookingId,
          cellStart: new Date(ms),
          kind,
          status: "confirmed" as const,
          createdAt: now,
        }));

        // All cells or none. A real booking already holding one of these
        // cells makes the insert throw 11000 (uniq_slot_claim); the seed
        // fails loudly rather than skipping the index.
        await session.withTransaction(
          async () => {
            await collections.bookings().insertOne(bookingDoc, { session });
            await collections.slotClaims().insertMany(claimDocs, { session, ordered: true });
          },
          { readConcern: { level: "local" }, writeConcern: { w: "majority" }, readPreference: "primary" },
        );
        created++;
      }
    }
  } finally {
    await session.endSession();
  }
  console.log(`demo data: ${created} booking(s) created, ${alreadySeeded} already present`);
}

async function seedVenueWithStations(seed: VenueSeed, stationInputs: StationInput[]): Promise<ObjectId> {
  const venueId = await upsertVenue(seed);
  for (const input of stationInputs) {
    await upsertStation(venueId, input);
  }
  const stationCount = await collections.stations().countDocuments({ venueId });
  console.log(`seeded "${seed.slug}": ${stationCount} station(s)`);
  return venueId;
}

async function main(): Promise<void> {
  const withDstVenue = process.argv.includes("--with-dst-venue");

  await connectMongo();
  await createIndexes();

  const stationInputs = buildStationInputs();
  const mainVenueId = await seedVenueWithStations(MAIN_VENUE, stationInputs);
  // Default on, so a fresh or prod reseed shows every availability state.
  if (!process.argv.includes("--no-demo-data")) await seedDemoData(mainVenueId);

  if (withDstVenue) {
    await seedVenueWithStations(DST_VENUE, []);
  }

  await mongoClient().close();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
