import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ObjectId } from "mongodb";
import type { AvailabilityResponse, BookingResponse } from "@playstop/types";
import { collections } from "#libs/mongo/index.js";
import { closeTestResources, futureSessionCells, seedVenue, startTestServer, wipeVenue, type TestServer, type TestVenue } from "#testing-support.js";

let server: TestServer;
let venue: TestVenue;

async function confirm(body: unknown): Promise<Response> {
  return fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
    body: JSON.stringify(body),
  });
}

async function cancel(bookingId: string, confirmationCode: string): Promise<Response> {
  return fetch(`${server.baseUrl}/v1/venues/${venue.slug}/bookings/${bookingId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmationCode }),
  });
}

test("cancel routes", async (t) => {
  server = await startTestServer();
  venue = await seedVenue({ maxSlots: 6 });
  const stationId = venue.stationIds[0]!.toHexString();

  // Test J: cancel frees the cells, and the same range can be re-booked,
  // which is the real proof the partial index released the constraint.
  await t.test("cancel frees the cells for a fresh booking", async () => {
    const { businessDate, cellStartMs } = futureSessionCells(venue, 3);
    const startsAt = new Date(cellStartMs[0]!).toISOString();
    const booked = await confirm({ stationId, startsAt, slotCount: 3, partySize: 1, player: { name: "A" } });
    assert.equal(booked.status, 201);
    const bookedBody = (await booked.json()) as BookingResponse;

    const availBefore = await fetch(
      `${server.baseUrl}/v1/venues/${venue.slug}/availability?date=${businessDate}&stationId=${stationId}`,
    );
    const availBeforeBody = (await availBefore.json()) as AvailabilityResponse;
    const targetCells = availBeforeBody.cells.filter((c) => cellStartMs.includes(new Date(c.startsAt).getTime()));
    assert.ok(targetCells.every((c) => c.state === "booked"));

    const cancelled = await cancel(bookedBody.id, bookedBody.confirmationCode);
    assert.equal(cancelled.status, 200);
    const cancelledBody = (await cancelled.json()) as BookingResponse;
    assert.equal(cancelledBody.status, "cancelled");
    assert.ok(cancelledBody.cancelledAt);

    const claimStates = await collections
      .slotClaims()
      .find({ venueId: venue.venueId, bookingId: new ObjectId(bookedBody.id) })
      .toArray();
    assert.ok(claimStates.every((c) => c.status === "cancelled"));

    const availAfter = await fetch(
      `${server.baseUrl}/v1/venues/${venue.slug}/availability?date=${businessDate}&stationId=${stationId}`,
    );
    const availAfterBody = (await availAfter.json()) as AvailabilityResponse;
    const targetCellsAfter = availAfterBody.cells.filter((c) => cellStartMs.includes(new Date(c.startsAt).getTime()));
    assert.ok(targetCellsAfter.every((c) => c.state === "free"));

    const rebooked = await confirm({ stationId, startsAt, slotCount: 3, partySize: 1, player: { name: "B" } });
    assert.equal(rebooked.status, 201);
  });

  // Test K: double cancel is idempotent; cancelledAt does not change.
  await t.test("double cancel returns 200 both times with the same cancelledAt", async () => {
    const { cellStartMs } = futureSessionCells(venue, 1);
    const booked = await confirm({
      stationId,
      startsAt: new Date(cellStartMs[0]!).toISOString(),
      slotCount: 1,
      partySize: 1,
      player: { name: "A" },
    });
    const bookedBody = (await booked.json()) as BookingResponse;

    const first = await cancel(bookedBody.id, bookedBody.confirmationCode);
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as BookingResponse;

    const second = await cancel(bookedBody.id, bookedBody.confirmationCode);
    assert.equal(second.status, 200);
    const secondBody = (await second.json()) as BookingResponse;

    assert.equal(firstBody.cancelledAt, secondBody.cancelledAt);
  });

  // Test L: wrong code, and a venue-B booking id under venue A's slug.
  await t.test("cancel authorization: wrong code and wrong venue are both 404", async () => {
    const { cellStartMs } = futureSessionCells(venue, 1);
    const booked = await confirm({
      stationId,
      startsAt: new Date(cellStartMs[0]!).toISOString(),
      slotCount: 1,
      partySize: 1,
      player: { name: "A" },
    });
    const bookedBody = (await booked.json()) as BookingResponse;

    const wrongCode = await cancel(bookedBody.id, "ZZZZZZZZZZ");
    assert.equal(wrongCode.status, 404);
    const wrongCodeBody = (await wrongCode.json()) as { error: { code: string } };
    assert.equal(wrongCodeBody.error.code, "BOOKING_NOT_FOUND");

    const otherVenue = await seedVenue();
    const wrongVenueRes = await fetch(
      `${server.baseUrl}/v1/venues/${otherVenue.slug}/bookings/${bookedBody.id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationCode: bookedBody.confirmationCode }),
      },
    );
    assert.equal(wrongVenueRes.status, 404);
    await wipeVenue(otherVenue.venueId);

    const stillConfirmed = await fetch(
      `${server.baseUrl}/v1/venues/${venue.slug}/bookings/${bookedBody.id}?code=${bookedBody.confirmationCode}`,
    );
    const stillConfirmedBody = (await stillConfirmed.json()) as BookingResponse;
    assert.equal(stillConfirmedBody.status, "confirmed");
  });

  // Test M: a booking whose session has already started cannot be cancelled.
  await t.test("a booking that already started is 422 BOOKING_NOT_CANCELLABLE", async () => {
    const { cellStartMs } = futureSessionCells(venue, 1);
    const booked = await confirm({
      stationId,
      startsAt: new Date(cellStartMs[0]!).toISOString(),
      slotCount: 1,
      partySize: 1,
      player: { name: "A" },
    });
    const bookedBody = (await booked.json()) as BookingResponse;

    await collections
      .bookings()
      .updateOne({ _id: new ObjectId(bookedBody.id) }, { $set: { startsAt: new Date(Date.now() - 60_000) } });

    const res = await cancel(bookedBody.id, bookedBody.confirmationCode);
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "BOOKING_NOT_CANCELLABLE");

    const stillConfirmed = await fetch(
      `${server.baseUrl}/v1/venues/${venue.slug}/bookings/${bookedBody.id}?code=${bookedBody.confirmationCode}`,
    );
    const stillConfirmedBody = (await stillConfirmed.json()) as BookingResponse;
    assert.equal(stillConfirmedBody.status, "confirmed");
  });

  await wipeVenue(venue.venueId);
  await server.close();
  await closeTestResources();
});
