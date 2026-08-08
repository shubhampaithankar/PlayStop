// Spec section 9, layer 3 lists Tests N, O, and P behind TEST_PROFILE=ci
// alongside the concurrency tests. None of these three need real
// contention -- they're single-request functional checks -- but the spec
// puts them in the same CI-only bucket, so a new file here follows suit
// rather than growing the always-run layer 2 suite (booking/controller.test.ts)
// past its current 40. See concurrency-confirm.test.ts for why the gate
// exists, and why every helper below is imported dynamically inside the
// skipped callback rather than statically at the top of the file.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DateTime } from "luxon";

const CI_ONLY = process.env.TEST_PROFILE === "ci";

function confirmBody(stationId: string, startsAt: string, slotCount: number): unknown {
  return { stationId, startsAt, slotCount, partySize: 1, player: { name: "Racer" } };
}

// Test N: a slotCount one above the station's maxSlots is rejected, run
// against two different profiles so a hardcoded limit (rather than reading
// station.maxSlots) fails at least one of them.
test(
  "N: per-station slotCount limits hold for both a racing sim and a PS5 profile",
  { skip: !CI_ONLY },
  async () => {
    const { collections } = await import("#libs/mongo/index.js");
    const { closeTestResources, futureSessionCells, seedVenue, startTestServer, wipeVenue } =
      await import("#testing-support.js");

    let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
    try {
      server = await startTestServer();

      for (const maxSlots of [4, 8]) {
        let venue: Awaited<ReturnType<typeof seedVenue>> | undefined;
        try {
          venue = await seedVenue({ maxSlots });
          const stationId = venue.stationIds[0]!.toHexString();
          const { cellStartMs } = futureSessionCells(venue, maxSlots + 1);

          const res = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
            body: JSON.stringify(
              confirmBody(stationId, new Date(cellStartMs[0]!).toISOString(), maxSlots + 1),
            ),
          });
          assert.equal(res.status, 422, `maxSlots ${maxSlots}: expected 422`);
          const body = (await res.json()) as { error: { code: string } };
          assert.equal(body.error.code, "SLOT_COUNT_OUT_OF_RANGE");

          const bookingCount = await collections
            .bookings()
            .countDocuments({ venueId: venue.venueId, stationId: venue.stationIds[0]! });
          assert.equal(
            bookingCount,
            0,
            `maxSlots ${maxSlots}: no booking should have been written`,
          );
          const claimCount = await collections
            .slotClaims()
            .countDocuments({ venueId: venue.venueId, stationId: venue.stationIds[0]! });
          assert.equal(claimCount, 0, `maxSlots ${maxSlots}: no claim should have been written`);
        } finally {
          if (venue) await wipeVenue(venue.venueId);
        }
      }
    } finally {
      if (server) await server.close();
      await closeTestResources();
    }
  },
);

// Test O: a midnight-crossing booking. The default seed venue is open
// 14:00-02:00, so a session's last two cells are on the calendar day after
// the business date. Book them and confirm the business date's availability
// shows them booked while the following calendar date's availability does
// not include those instants at all.
test(
  "O: a midnight-crossing booking shows up on its business date only",
  { skip: !CI_ONLY },
  async () => {
    const { closeTestResources, futureSessionCells, seedVenue, startTestServer, wipeVenue } =
      await import("#testing-support.js");

    let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
    let venue: Awaited<ReturnType<typeof seedVenue>> | undefined;
    try {
      server = await startTestServer();
      venue = await seedVenue({ maxSlots: 8 });
      const stationId = venue.stationIds[0]!.toHexString();

      const { businessDate, cellStartMs } = futureSessionCells(venue, 24); // the whole 14:00-02:00 session
      const lateNightStart = cellStartMs[22]!; // local 01:00, the day after businessDate
      const lateNightCells = [cellStartMs[22]!, cellStartMs[23]!];

      const res = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify(confirmBody(stationId, new Date(lateNightStart).toISOString(), 2)),
      });
      assert.equal(res.status, 201);

      const availSameDate = await fetch(
        `${server.baseUrl}/v1/venues/${venue.slug}/availability?date=${businessDate}&stationId=${stationId}`,
      );
      const availSameDateBody = (await availSameDate.json()) as {
        cells: { startsAt: string; state: string }[];
      };
      const bookedCells = availSameDateBody.cells.filter((c) =>
        lateNightCells.includes(new Date(c.startsAt).getTime()),
      );
      assert.equal(bookedCells.length, 2);
      assert.ok(bookedCells.every((c) => c.state === "booked"));

      const nextDate = DateTime.fromISO(businessDate, { zone: venue.schedule.timezone })
        .plus({ days: 1 })
        .toISODate();
      assert.ok(nextDate);
      const availNextDate = await fetch(
        `${server.baseUrl}/v1/venues/${venue.slug}/availability?date=${nextDate}&stationId=${stationId}`,
      );
      const availNextDateBody = (await availNextDate.json()) as { cells: { startsAt: string }[] };
      const leaked = availNextDateBody.cells.some((c) =>
        lateNightCells.includes(new Date(c.startsAt).getTime()),
      );
      assert.equal(
        leaked,
        false,
        "the booked instants must not appear under the following calendar date",
      );
    } finally {
      if (venue) await wipeVenue(venue.venueId);
      if (server) await server.close();
      await closeTestResources();
    }
  },
);

// Test P: a booking cannot extend past closing. Starting at the
// third-from-last cell of the session and asking for 4 slots needs a cell
// that doesn't exist.
test(
  "P: a booking starting near the end of the session cannot extend past closing",
  { skip: !CI_ONLY },
  async () => {
    const { collections } = await import("#libs/mongo/index.js");
    const { closeTestResources, futureSessionCells, seedVenue, startTestServer, wipeVenue } =
      await import("#testing-support.js");

    let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
    let venue: Awaited<ReturnType<typeof seedVenue>> | undefined;
    try {
      server = await startTestServer();
      venue = await seedVenue({ maxSlots: 8 });
      const stationId = venue.stationIds[0]!.toHexString();
      const { cellStartMs } = futureSessionCells(venue, 24);
      const thirdFromLast = cellStartMs[21]!; // cells 21,22,23 exist; a 4th would not

      const res = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify(confirmBody(stationId, new Date(thirdFromLast).toISOString(), 4)),
      });
      assert.equal(res.status, 422);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "SLOT_OUT_OF_WINDOW");

      const claimCount = await collections
        .slotClaims()
        .countDocuments({ venueId: venue.venueId, stationId: venue.stationIds[0]! });
      assert.equal(claimCount, 0);
    } finally {
      if (venue) await wipeVenue(venue.venueId);
      if (server) await server.close();
      await closeTestResources();
    }
  },
);
