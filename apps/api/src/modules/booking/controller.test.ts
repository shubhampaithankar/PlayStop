import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { BookingResponse, CreateHoldResponse } from "@playstop/types";
import { collections } from "#libs/mongo/index.js";
import { hashRequest } from "#modules/booking/idempotency.js";
import {
  futureSessionCells,
  seedVenue,
  startTestServer,
  teardown,
  wipeVenue,
  type TestServer,
  type TestVenue,
} from "#testing-support.js";

let server: TestServer;
let venue: TestVenue;

function player(): { name: string } {
  return { name: "Test Player" };
}

async function confirm(
  body: unknown,
  idempotencyKey: string | null = randomUUID(),
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey !== null) headers["Idempotency-Key"] = idempotencyKey;
  return fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("booking confirm and read routes", async (t) => {
  // try/finally: a failing assertion must not skip closing the server,
  // Mongo pool, and ioredis client -- an unclosed ioredis client keeps
  // retrying forever and hangs the file instead of reporting a failure.
  try {
    server = await startTestServer();
    venue = await seedVenue({ maxSlots: 6, capacity: 4 });
    const stationId = venue.stationIds[0]!.toHexString();

    await t.test("confirms a multi-cell booking and prices it correctly", async () => {
      const { cellStartMs } = futureSessionCells(venue, 3);
      const res = await confirm({
        stationId,
        startsAt: new Date(cellStartMs[0]!).toISOString(),
        slotCount: 3,
        partySize: 2,
        player: player(),
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as BookingResponse;
      assert.equal(body.slotCount, 3);
      assert.equal(body.totalMinor, (1200 * 3 * 30) / 60); // hourlyRateMinor * slotCount * gridMinutes/60
      assert.match(body.confirmationCode, /^[0-9A-HJKMNP-TV-Z]{10}$/);

      const read = await fetch(
        `${server.baseUrl}/v1/venues/${venue.slug}/bookings/${body.id}?code=${body.confirmationCode}`,
      );
      assert.equal(read.status, 200);
      const readBody = (await read.json()) as BookingResponse;
      assert.equal(readBody.id, body.id);
    });

    await t.test("missing Idempotency-Key is 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
      const { cellStartMs } = futureSessionCells(venue, 1);
      const res = await confirm(
        {
          stationId,
          startsAt: new Date(cellStartMs[0]!).toISOString(),
          slotCount: 1,
          partySize: 1,
          player: player(),
        },
        null,
      );
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
    });

    await t.test("a malformed body is 400 VALIDATION_FAILED", async () => {
      const res = await confirm({
        stationId,
        startsAt: "not-a-date",
        slotCount: 1,
        partySize: 1,
        player: player(),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "VALIDATION_FAILED");
    });

    await t.test("an unknown station is 404 STATION_NOT_FOUND", async () => {
      const { cellStartMs } = futureSessionCells(venue, 1);
      const res = await confirm({
        stationId: "507f1f77bcf86cd799439011",
        startsAt: new Date(cellStartMs[0]!).toISOString(),
        slotCount: 1,
        partySize: 1,
        player: player(),
      });
      assert.equal(res.status, 404);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "STATION_NOT_FOUND");
    });

    await t.test("partySize over capacity is 422 PARTY_SIZE_EXCEEDS_CAPACITY", async () => {
      const { cellStartMs } = futureSessionCells(venue, 1);
      const res = await confirm({
        stationId,
        startsAt: new Date(cellStartMs[0]!).toISOString(),
        slotCount: 1,
        partySize: 5, // capacity is 4
        player: player(),
      });
      assert.equal(res.status, 422);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "PARTY_SIZE_EXCEEDS_CAPACITY");
    });

    await t.test(
      "slotCount over the station's maxSlots is 422 SLOT_COUNT_OUT_OF_RANGE",
      async () => {
        const { cellStartMs } = futureSessionCells(venue, 1);
        const res = await confirm({
          stationId,
          startsAt: new Date(cellStartMs[0]!).toISOString(),
          slotCount: 7, // maxSlots is 6
          partySize: 1,
          player: player(),
        });
        assert.equal(res.status, 422);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "SLOT_COUNT_OUT_OF_RANGE");
      },
    );

    await t.test("a startsAt off the grid is 422 SLOT_NOT_ON_GRID", async () => {
      const { cellStartMs } = futureSessionCells(venue, 1);
      const res = await confirm({
        stationId,
        startsAt: new Date(cellStartMs[0]! + 5 * 60_000).toISOString(), // 5 minutes off-grid
        slotCount: 1,
        partySize: 1,
        player: player(),
      });
      assert.equal(res.status, 422);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "SLOT_NOT_ON_GRID");
    });

    await t.test("a range extending past closing is 422 SLOT_OUT_OF_WINDOW", async () => {
      const { cellStartMs } = futureSessionCells(venue, 24); // the whole 24-cell session
      const res = await confirm({
        stationId,
        startsAt: new Date(cellStartMs[23]!).toISOString(), // last cell of the session
        slotCount: 2, // would need a 25th cell
        partySize: 1,
        player: player(),
      });
      assert.equal(res.status, 422);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "SLOT_OUT_OF_WINDOW");
    });

    await t.test("a maintenance window overlapping the range is 409 SLOT_UNAVAILABLE", async () => {
      const { cellStartMs } = futureSessionCells(venue, 1);
      const cellStart = cellStartMs[0]!;
      await collections
        .stations()
        .updateOne(
          { _id: venue.stationIds[0]! },
          {
            $set: {
              maintenanceWindows: [
                { startsAt: new Date(cellStart), endsAt: new Date(cellStart + 30 * 60_000) },
              ],
            },
          },
        );
      const res = await confirm({
        stationId,
        startsAt: new Date(cellStart).toISOString(),
        slotCount: 1,
        partySize: 1,
        player: player(),
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "SLOT_UNAVAILABLE");
      await collections
        .stations()
        .updateOne({ _id: venue.stationIds[0]! }, { $set: { maintenanceWindows: [] } });
    });

    await t.test("booking an already-confirmed cell is 409 SLOT_TAKEN", async () => {
      const { cellStartMs } = futureSessionCells(venue, 1);
      const startsAt = new Date(cellStartMs[0]!).toISOString();
      const first = await confirm({
        stationId,
        startsAt,
        slotCount: 1,
        partySize: 1,
        player: player(),
      });
      assert.equal(first.status, 201);

      const second = await confirm({
        stationId,
        startsAt,
        slotCount: 1,
        partySize: 1,
        player: player(),
      });
      assert.equal(second.status, 409);
      const secondBody = (await second.json()) as { error: { code: string } };
      assert.equal(secondBody.error.code, "SLOT_TAKEN");

      // No orphan claim: exactly one confirmed claim for the cell.
      const claimCount = await collections.slotClaims().countDocuments({
        venueId: venue.venueId,
        stationId: venue.stationIds[0]!,
        cellStart: new Date(cellStartMs[0]!),
        status: "confirmed",
      });
      assert.equal(claimCount, 1);
    });

    await t.test("confirming with a foreign holdId is 409 SLOT_HELD", async () => {
      const { cellStartMs } = futureSessionCells(venue, 1);
      const startsAt = new Date(cellStartMs[0]!).toISOString();
      const hold = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/holds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationId, startsAt, slotCount: 1 }),
      });
      assert.equal(hold.status, 201);
      const holdBody = (await hold.json()) as CreateHoldResponse;

      const res = await confirm({
        stationId,
        startsAt,
        slotCount: 1,
        partySize: 1,
        player: player(),
        holdId: randomUUID(), // not the real holder
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, "SLOT_HELD");

      await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/holds/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdId: holdBody.holdId, stationId, startsAt, slotCount: 1 }),
      });
    });

    // Test G: hold expiry. Releasing the hold before confirming simulates the
    // TTL firing: MGET sees the key gone, none foreign.
    await t.test(
      "confirming with an expired holdId is 410, then succeeds without one",
      async () => {
        const { cellStartMs } = futureSessionCells(venue, 1);
        const startsAt = new Date(cellStartMs[0]!).toISOString();
        const hold = await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/holds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stationId, startsAt, slotCount: 1 }),
        });
        const holdBody = (await hold.json()) as CreateHoldResponse;
        await fetch(`${server.baseUrl}/v1/venues/${venue.slug}/holds/release`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ holdId: holdBody.holdId, stationId, startsAt, slotCount: 1 }),
        });

        const expired = await confirm({
          stationId,
          startsAt,
          slotCount: 1,
          partySize: 1,
          player: player(),
          holdId: holdBody.holdId,
        });
        assert.equal(expired.status, 410);
        const expiredBody = (await expired.json()) as { error: { code: string } };
        assert.equal(expiredBody.error.code, "HOLD_EXPIRED");

        const withoutHold = await confirm({
          stationId,
          startsAt,
          slotCount: 1,
          partySize: 1,
          player: player(),
        });
        assert.equal(withoutHold.status, 201);
      },
    );

    // Test E + F: same key replays; same key with a different body is rejected.
    await t.test("idempotent replay and key reuse", async () => {
      const { cellStartMs } = futureSessionCells(venue, 1);
      const startsAt = new Date(cellStartMs[0]!).toISOString();
      const key = randomUUID();
      const body = { stationId, startsAt, slotCount: 1, partySize: 1, player: player() };

      const first = await confirm(body, key);
      assert.equal(first.status, 201);
      const firstBody = (await first.json()) as BookingResponse;

      const replay = await confirm(body, key);
      assert.equal(replay.status, 201);
      assert.equal(replay.headers.get("Idempotent-Replay"), "true");
      const replayBody = (await replay.json()) as BookingResponse;
      assert.deepEqual(replayBody, firstBody);

      const reused = await confirm({ ...body, partySize: 2 }, key);
      assert.equal(reused.status, 422);
      const reusedBody = (await reused.json()) as { error: { code: string } };
      assert.equal(reusedBody.error.code, "IDEMPOTENCY_KEY_REUSED");
    });

    await t.test("a request racing an in-flight claim gets 409 REQUEST_IN_FLIGHT", async () => {
      const key = randomUUID();
      const id = `${venue.venueId.toHexString()}:${key}`;
      const body = {
        stationId,
        startsAt: "2026-08-07T08:30:00.000Z",
        slotCount: 1,
        partySize: 1,
        player: player(),
      };
      const requestHash = hashRequest(body);
      await collections.idempotency().insertOne({
        _id: id,
        venueId: venue.venueId,
        key,
        requestHash,
        state: "in_flight",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      const res = await confirm(body, key);
      assert.equal(res.status, 409);
      const resBody = (await res.json()) as { error: { code: string } };
      assert.equal(resBody.error.code, "REQUEST_IN_FLIGHT");
      assert.equal(res.headers.get("Retry-After"), "1");

      await collections.idempotency().deleteOne({ _id: id });
    });

    // Test I: the middle cell is the one that loses. If the transaction is
    // missing, S1's claim would survive the S2 conflict.
    await t.test(
      "a partial multi-cell booking is impossible (loses on the middle cell)",
      async () => {
        const { cellStartMs } = futureSessionCells(venue, 3);
        const [s1, s2, s3] = cellStartMs as [number, number, number];

        const single = await confirm({
          stationId,
          startsAt: new Date(s2).toISOString(),
          slotCount: 1,
          partySize: 1,
          player: player(),
        });
        assert.equal(single.status, 201);

        const triple = await confirm({
          stationId,
          startsAt: new Date(s1).toISOString(),
          slotCount: 3,
          partySize: 1,
          player: player(),
        });
        assert.equal(triple.status, 409);
        const tripleBody = (await triple.json()) as { error: { code: string } };
        assert.equal(tripleBody.error.code, "SLOT_TAKEN");

        assert.equal(
          await collections
            .slotClaims()
            .countDocuments({
              venueId: venue.venueId,
              stationId: venue.stationIds[0]!,
              cellStart: new Date(s1),
            }),
          0,
        );
        assert.equal(
          await collections
            .slotClaims()
            .countDocuments({
              venueId: venue.venueId,
              stationId: venue.stationIds[0]!,
              cellStart: new Date(s3),
            }),
          0,
        );
        assert.equal(
          await collections.slotClaims().countDocuments({
            venueId: venue.venueId,
            stationId: venue.stationIds[0]!,
            cellStart: new Date(s2),
            status: "confirmed",
          }),
          1,
        );
        assert.equal(
          await collections
            .bookings()
            .countDocuments({
              venueId: venue.venueId,
              stationId: venue.stationIds[0]!,
              startsAt: new Date(s1),
            }),
          0,
        );
      },
    );

    await t.test("reading a booking with the wrong code is 404 BOOKING_NOT_FOUND", async () => {
      const { cellStartMs } = futureSessionCells(venue, 1);
      const res = await confirm({
        stationId,
        startsAt: new Date(cellStartMs[0]!).toISOString(),
        slotCount: 1,
        partySize: 1,
        player: player(),
      });
      const body = (await res.json()) as BookingResponse;
      const read = await fetch(
        `${server.baseUrl}/v1/venues/${venue.slug}/bookings/${body.id}?code=ZZZZZZZZZZ`,
      );
      assert.equal(read.status, 404);
      const readBody = (await read.json()) as { error: { code: string } };
      assert.equal(readBody.error.code, "BOOKING_NOT_FOUND");
    });

    await t.test(
      "cross-tenant: a station id from venue B is 404 under venue A's slug",
      async () => {
        const otherVenue = await seedVenue();
        const { cellStartMs } = futureSessionCells(venue, 1);
        const res = await confirm({
          stationId: otherVenue.stationIds[0]!.toHexString(),
          startsAt: new Date(cellStartMs[0]!).toISOString(),
          slotCount: 1,
          partySize: 1,
          player: player(),
        });
        assert.equal(res.status, 404);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "STATION_NOT_FOUND");
        await wipeVenue(otherVenue.venueId);
      },
    );
  } finally {
    await teardown(venue, server);
  }
});
