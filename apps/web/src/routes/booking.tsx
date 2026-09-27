// `/booking/:id` -- screen 5, "Booked" (DESIGN.md section 5). Confirmation
// code, recap, cancel. Loads from the cache seeded by screen 4's
// setQueryData on the happy path, or fetches with `?code=` on a reload or a
// pasted link.
//
// Relative .js-extension imports for the same reason as routes/root.tsx:
// apps/web/tests/router.test.ts imports router.tsx (and therefore this
// file) under plain `node --test`, which has no Vite alias resolution.
import { useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { createRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { rootRoute } from "./root.js";
import { bookingOptions, keys, venueOptions, invalidateAvailability } from "../lib/query-client.js";
import { ApiRequestError, cancelBooking, errorPresentation } from "../lib/api.js";
import { instantLabel } from "../lib/stations.js";
import { currentBusinessDate, businessDateLabel } from "../lib/business-date.js";
import { SkeletonBox, ConfirmDialog, FOCUS_RING } from "../components/screen-ui.js";

// .catch(undefined) rather than a bare .optional(): validateSearch throwing
// escapes to the ROOT error boundary and would replace the whole app with
// "Something broke" for one stale link -- same reasoning as
// routes/book.station.tsx's searchSchema.
const searchSchema = z.object({
  code: z.string().optional().catch(undefined),
});

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-4 py-8 text-center md:px-6">
      {children}
    </main>
  );
}

function MissingCodeState() {
  return (
    <PageShell>
      <h2 className="font-display text-[2rem] leading-[1.1] uppercase tracking-wide">Booking not found</h2>
      <p className="text-muted-foreground max-w-sm text-sm">
        We could not find that booking. Check the link, including the code at the end.
      </p>
    </PageShell>
  );
}

function ErrorState({ error }: { error: unknown }) {
  const message =
    error instanceof ApiRequestError ? errorPresentation[error.code].detail : "Something went wrong. Please try again.";
  return (
    <PageShell>
      <h2 className="font-display text-[2rem] leading-[1.1] uppercase tracking-wide">Booking not found</h2>
      <p className="text-muted-foreground max-w-sm text-sm">{message}</p>
    </PageShell>
  );
}

function SkeletonState() {
  return (
    <PageShell>
      <SkeletonBox className="h-8 w-48 rounded-(--radius)" />
      <SkeletonBox className="h-32 w-full rounded-(--radius-card)" />
      <SkeletonBox className="h-4 w-64 rounded-(--radius)" />
    </PageShell>
  );
}

function BookedScreen() {
  const { bookingId } = bookingRoute.useParams();
  const search = bookingRoute.useSearch();
  const queryClient = useQueryClient();

  const bookingQuery = useQuery({
    ...bookingOptions(bookingId, search.code ?? ""),
    enabled: search.code !== undefined,
  });
  // The venue query is cached with staleTime: Infinity from earlier in the
  // flow (see lib/query-client.ts); a direct/bookmarked visit to this route
  // fetches it fresh. Needed only for the end time -- the booking response
  // carries no timezone, and localLabel covers the start alone.
  const venueQuery = useQuery(venueOptions());

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const codeRef = useRef<HTMLElement>(null);

  if (search.code === undefined) return <MissingCodeState />;
  if (bookingQuery.isError) return <ErrorState error={bookingQuery.error} />;
  if (bookingQuery.isPending || venueQuery.isPending) return <SkeletonState />;
  if (venueQuery.isError) return <ErrorState error={venueQuery.error} />;

  const booking = bookingQuery.data;
  const venue = venueQuery.data;
  if (!booking || !venue) return null; // exhausts pending/error/success

  const startLabel = instantLabel(booking.startsAt, venue.timezone);
  const endLabel = instantLabel(booking.endsAt, venue.timezone);
  // The date the booking's own session falls on, not "now" -- the same
  // yesterday-crosses-midnight logic currentBusinessDate uses for "which
  // session is running", applied to the booking's start instant instead.
  const bookingDate = currentBusinessDate(venue, new Date(booking.startsAt));
  const dateLabel = businessDateLabel(venue, new Date(nowMs), bookingDate);
  const totalRupees = booking.totalMinor / 100;
  const cancelled = booking.status === "cancelled";
  const started = Date.parse(booking.startsAt) <= nowMs;

  async function handleCopy() {
    const code = booking.confirmationCode;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(code);
        toast("Copied", { description: "Confirmation code copied." });
        return;
      } catch {
        // Clipboard blocked or unavailable -- fall through to selection.
      }
    }
    const node = codeRef.current;
    if (node && typeof window !== "undefined") {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const cancelledBooking = await cancelBooking(bookingId, search.code as string);
      queryClient.setQueryData(keys.booking(bookingId), cancelledBooking);
      invalidateAvailability(queryClient);
      setCancelOpen(false);
    } catch (err) {
      setCancelOpen(false);
      // BOOKING_NOT_CANCELLABLE ("Close the confirm dialog, refetch the
      // booking", section 6) and everything else: refetch and toast.
      void queryClient.invalidateQueries({ queryKey: keys.booking(bookingId) });
      const message =
        err instanceof ApiRequestError ? errorPresentation[err.code].detail : "Something went wrong. Please try again.";
      toast(err instanceof ApiRequestError ? errorPresentation[err.code].title : "Something went wrong", {
        description: message,
      });
    } finally {
      setCancelling(false);
    }
  }

  return (
    <PageShell>
      <h2 className="font-display text-[2rem] leading-[1.1] uppercase tracking-wide">
        {cancelled ? "Booking cancelled" : "You're booked"}
      </h2>
      {/* The ticket stub, issued: code above the tear, station and time
          below it (DESIGN.md Imagery, round-6 remainder). */}
      <div className="stub stub-issued w-full p-6">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={`anim-stamp flex w-full flex-col items-center gap-1 ${FOCUS_RING}`}
          aria-label="Copy confirmation code"
        >
          <code
            ref={codeRef}
            // ponytail: fixed clamp ceiling (3.25rem, tracking normal) fits a
            // worst-case 11-char code in the 352px stub content box at any
            // viewport, cheaper than a container query for a fixed-width column.
            className={`font-mono text-[clamp(2rem,11vw,3.25rem)] font-medium ${cancelled ? "text-muted-foreground line-through" : ""}`}
          >
            {booking.confirmationCode}
          </code>
          {cancelled ? (
            <span className="text-stop-red dark:text-stop-red-bright text-sm font-semibold uppercase tracking-wide">Cancelled</span>
          ) : null}
        </button>
        <div className="stub-perf my-4" />
        <p className="text-muted-foreground text-sm">
          {booking.stationName}, {dateLabel}, {startLabel} to {endLabel}.
        </p>
      </div>
      {cancelled ? null : <p className="text-base font-semibold">Show this code at the counter.</p>}
      <p className="text-muted-foreground text-sm">
        {cancelled ? "This booking was cancelled." : `Pay ₹${totalRupees} at the counter.`}
      </p>
      {cancelled ? (
        <Link
          to="/book"
          className={`pressable btn-go flex h-12 w-full items-center justify-center rounded-(--radius) text-base font-semibold ${FOCUS_RING}`}
        >
          Book again
        </Link>
      ) : !started ? (
        <button
          type="button"
          onClick={() => setCancelOpen(true)}
          className={`pressable text-stop-red dark:text-stop-red-bright flex h-11 items-center justify-center rounded-(--radius) border px-4 text-sm ${FOCUS_RING}`}
        >
          Cancel this booking
        </button>
      ) : null}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this booking?"
        description="This cannot be undone. The console will be released for others to book."
        confirmLabel="Cancel booking"
        confirming={cancelling}
        onConfirm={() => void handleCancel()}
      />
    </PageShell>
  );
}

export const bookingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/booking/$bookingId",
  validateSearch: (search) => searchSchema.parse(search),
  component: BookedScreen,
});
