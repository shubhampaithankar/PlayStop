// `/bookings` -- the device-local list of bookings this browser has opened
// (lib/booking-history.ts). Each row reopens `/booking/:id?code=...`.
//
// Relative .js-extension imports for the same reason as routes/root.tsx.
import { useState } from "react";
import { createRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { rootRoute } from "./root.js";
import { venueOptions } from "../lib/query-client.js";
import { readBookings } from "../lib/booking-history.js";
import { instantLabel } from "../lib/stations.js";
import { currentBusinessDate, businessDateLabel } from "../lib/business-date.js";
import { ArrowLeft } from "lucide-react";
import { LoadingScreen, FOCUS_RING, UNDERLINE_LINK, BACK_LINK } from "../components/screen-ui.js";

function BookingsScreen() {
  const [bookings] = useState(readBookings);
  const [nowMs] = useState(() => Date.now());
  // Cached from earlier in the flow, or fetched fresh on a direct visit.
  // Needed for the venue timezone and business-date logic, never recomputed here.
  const venueQuery = useQuery(venueOptions());
  const venue = venueQuery.data;

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
          <ul className="flex flex-col gap-3">
            {bookings.map((booking) => {
              const dateLabel = businessDateLabel(
                venue,
                new Date(nowMs),
                currentBusinessDate(venue, new Date(booking.startsAtMs)),
              );
              const startLabel = instantLabel(new Date(booking.startsAtMs).toISOString(), venue.timezone);
              const endLabel = instantLabel(new Date(booking.endsAtMs).toISOString(), venue.timezone);
              return (
                <li key={booking.id}>
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
            })}
          </ul>
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
