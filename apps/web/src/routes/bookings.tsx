import { useState } from "react";
import { createRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { rootRoute } from "./root.js";
import { venueOptions } from "../lib/query-client.js";
import { readBookings, type SavedBooking } from "../lib/booking-history.js";
import { instantLabel } from "../lib/stations.js";
import type { VenueResponse } from "@playstop/engine";
import { currentBusinessDate, businessDateLabel } from "../lib/business-date.js";
import { ArrowLeft } from "lucide-react";
import { LoadingScreen, FOCUS_RING, UNDERLINE_LINK, BACK_LINK } from "../components/screen-ui.js";

function BookingRow({
  booking,
  venue,
  nowMs,
}: {
  booking: SavedBooking;
  venue: Pick<VenueResponse, "timezone" | "openingHours">;
  nowMs: number;
}) {
  const dateLabel = businessDateLabel(venue, new Date(nowMs), currentBusinessDate(venue, new Date(booking.startsAtMs)));
  const startLabel = instantLabel(new Date(booking.startsAtMs).toISOString(), venue.timezone);
  const endLabel = instantLabel(new Date(booking.endsAtMs).toISOString(), venue.timezone);
  return (
    <li>
      <Link
        to="/booking/$bookingId"
        params={{ bookingId: booking.id }}
        search={{ code: booking.code }}
        className={`pressable border-border flex flex-col gap-1 rounded-(--radius-card) border p-4 ${FOCUS_RING}`}
      >
        <span className="text-base font-semibold">{booking.stationName}</span>
        <span className="text-muted-foreground text-sm">
          {dateLabel}, {startLabel} to {endLabel}
        </span>
        <code className="font-mono text-sm">{booking.code}</code>
      </Link>
    </li>
  );
}

function BookingsScreen() {
  const [bookings] = useState(readBookings);
  const [nowMs] = useState(() => Date.now());
  const venueQuery = useQuery(venueOptions());
  const venue = venueQuery.data;
  const upcoming = bookings.filter((booking) => booking.endsAtMs >= nowMs);
  const past = bookings.filter((booking) => booking.endsAtMs < nowMs);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-8 md:px-6">
      <h2 className="font-display text-[2rem] leading-[1.1] uppercase tracking-wide">Your bookings</h2>
      {bookings.length === 0 ? (
        <>
          <p className="text-muted-foreground text-sm">No bookings on this device yet.</p>
          <Link
            to="/book"
            className={`pressable btn-go flex h-12 w-full items-center justify-center rounded-(--radius) text-base font-semibold ${FOCUS_RING}`}
          >
            Book a console
          </Link>
        </>
      ) : venueQuery.isError ? (
        <p className="text-muted-foreground text-sm">Something went wrong. Please try again.</p>
      ) : !venue ? (
        <LoadingScreen />
      ) : (
        <>
          {upcoming.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {upcoming.map((booking) => (
                <BookingRow key={booking.id} booking={booking} venue={venue} nowMs={nowMs} />
              ))}
            </ul>
          ) : null}
          {past.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Past</h3>
              <ul className="flex flex-col gap-3 opacity-60">
                {past.map((booking) => (
                  <BookingRow key={booking.id} booking={booking} venue={venue} nowMs={nowMs} />
                ))}
              </ul>
            </section>
          ) : null}
          <p className="text-muted-foreground text-xs">Saved on this device only. Clearing site data removes the list.</p>
        </>
      )}
      <Link to="/bookings/find" className={UNDERLINE_LINK}>
        Find bookings on another device
      </Link>
      <Link to="/book" className={BACK_LINK}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to booking
      </Link>
    </main>
  );
}

export const bookingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bookings",
  component: BookingsScreen,
});
