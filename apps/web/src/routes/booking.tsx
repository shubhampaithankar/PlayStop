import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { createRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { rootRoute } from "./root.js";
import { queryClient, bookingOptions, keys, venueOptions, invalidateAvailability } from "../lib/query-client.js";
import { ApiRequestError, cancelBooking, errorPresentation } from "../lib/api.js";
import { instantLabel } from "../lib/stations.js";
import { currentBusinessDate, businessDateLabel } from "../lib/business-date.js";
import { saveBooking } from "../lib/booking-history.js";
import { LoadingScreen, ConfirmDialog, FOCUS_RING, UNDERLINE_LINK } from "../components/screen-ui.js";

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
      <LoadingScreen />
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
  const venueQuery = useQuery(venueOptions());

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const codeRef = useRef<HTMLElement>(null);

  const loadedBooking = bookingQuery.data;
  const savedCode = search.code;
  useEffect(() => {
    if (!loadedBooking || savedCode === undefined) return;
    saveBooking({
      id: loadedBooking.id,
      code: savedCode,
      stationName: loadedBooking.stationName,
      kind: loadedBooking.stationKind,
      startsAtMs: Date.parse(loadedBooking.startsAt),
      endsAtMs: Date.parse(loadedBooking.endsAt),
      savedAtMs: Date.now(),
    });
  }, [loadedBooking, savedCode]);

  if (search.code === undefined) return <MissingCodeState />;
  if (bookingQuery.isError) return <ErrorState error={bookingQuery.error} />;
  if (bookingQuery.isPending || venueQuery.isPending) return <SkeletonState />;
  if (venueQuery.isError) return <ErrorState error={venueQuery.error} />;

  const booking = bookingQuery.data;
  const venue = venueQuery.data;
  if (!booking || !venue) return <SkeletonState />;

  const startLabel = instantLabel(booking.startsAt, venue.timezone);
  const endLabel = instantLabel(booking.endsAt, venue.timezone);
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
      <div className="stub stub-issued w-full p-6">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={`anim-stamp flex w-full flex-col items-center gap-1 ${FOCUS_RING}`}
          aria-label="Copy confirmation code"
        >
          <code
            ref={codeRef}
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
      <Link to="/bookings" className={UNDERLINE_LINK}>
        Your bookings on this device
      </Link>
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
  loaderDeps: ({ search }) => ({ code: search.code }),
  loader: ({ params, deps }) =>
    deps.code ? queryClient.ensureQueryData(bookingOptions(params.bookingId, deps.code)).catch(() => undefined) : undefined,
  component: BookedScreen,
});
