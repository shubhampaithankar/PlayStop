// `/book/:stationId` -- child of book.tsx. Screens 2-4: "Pick a start time",
// "How long?", and "Your details" (DESIGN.md sections 2-4). `start` and
// `slots` are search params, not path segments (milestone-3-spec.md section
// 5: "Every piece of state that must survive a reload, a back button, or a
// pasted link is a search param").
//
// Relative .js-extension imports for the same reason as routes/root.tsx:
// apps/web/tests/router.test.ts imports this file under plain `node --test`.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createBookingRequestSchema, otpContactSchema } from "@playstop/engine";
import type {
  AvailabilityCell,
  CreateBookingRequest,
  CreateHoldResponse,
  OtpChannel,
  OtpContact,
  StationSummary,
  VenueResponse,
} from "@playstop/engine";
import { bookRoute } from "./book.js";
import { venueOptions, availabilityOptions, invalidateAvailability, keys } from "../lib/query-client.js";
import { toast } from "sonner";
import {
  ApiRequestError,
  NetworkError,
  createBooking,
  createHold,
  errorPresentation,
  playerFieldErrors,
  releaseHold,
  releaseHoldBeacon,
  requestOtp,
  verifyOtp,
} from "../lib/api.js";
import { CELL_STATES } from "@playstop/types";
import { currentBusinessDate } from "../lib/business-date.js";
import { countdownState } from "../lib/countdown.js";
import {
  bookingPriceRupees,
  cellsByStation,
  endTimeLabel,
  hourlyRateRupees,
  lengthOptionsForStart,
  nonStartableWord,
  pickStationForKind,
  startCellState,
  timeCellRows,
  timeLabelOf,
  type LengthOption,
  type TimeCellRow,
} from "../lib/stations.js";
import {
  classifyReload,
  clearAttempt,
  readAttempt,
  readSelectedDate,
  writeAttempt,
  type BookingAttempt,
  type RouteBookingParams,
} from "../lib/attempt.js";
import {
  Notice,
  SkeletonBox,
  TextField,
  FOCUS_RING,
  riseDelay,
  StepHeading,
  advanceAfterBeat,
} from "../components/screen-ui.js";

// .catch(undefined) rather than a bare .optional(): validateSearch throwing
// escapes to the ROOT error boundary, so one stale or hand-edited link would
// replace the whole app with "Something broke". A junk param degrading to
// "not selected" lands the user on an earlier screen instead, and nothing is
// lost by it -- every instant is re-validated server side on hold and on
// confirm (SLOT_NOT_ON_GRID), so a bad value can never reach a booking.
const searchSchema = z.object({
  // A cell's startsAt, verbatim -- never reconstructed or reformatted.
  start: z.string().optional().catch(undefined),
  slots: z.number().int().positive().optional().catch(undefined),
});

function ErrorNotice({ error }: { error: unknown }) {
  const message =
    error instanceof ApiRequestError ? errorPresentation[error.code].detail : "Something went wrong. Please try again.";
  return <Notice tone="destructive">{message}</Notice>;
}

function PageShell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8 md:px-6">{children}</main>;
}

function SkeletonScreen({ step, rows }: { step: string; rows: number }) {
  return (
    <PageShell>
      <StepHeading step={step} title="…" />
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: rows }, (_, index) => (
          <SkeletonBox key={index} className="h-14 rounded-(--radius)" />
        ))}
      </div>
    </PageShell>
  );
}

/* Screen 2: "Pick a start time" (DESIGN.md section 2). */
function PickTimeScreen({
  station,
  rows,
  onBack,
  onPick,
}: {
  station: StationSummary;
  rows: TimeCellRow[];
  onBack: () => void;
  onPick: (startsAt: string) => void;
}) {
  return (
    <PageShell>
      <StepHeading step="Step 2 of 4" title="Pick a start time" onBack={onBack} />
      <p className="anim-rise text-muted-foreground text-sm">
        {station.name}, <span className="font-mono font-medium">₹{hourlyRateRupees(station)}</span> an hour
      </p>
      {rows.length === 0 ? (
        <Notice>No start times are left for this console on this date.</Notice>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {rows.map((row, index) => {
            const label = timeLabelOf(row.cell);
            if (row.kind === "cell" && row.startable) {
              return (
                <button
                  key={row.cell.startsAt}
                  type="button"
                  onClick={() => advanceAfterBeat(() => onPick(row.cell.startsAt))}
                  style={riseDelay(index)}
                  className={`anim-rise pressable tile lift h-14 font-mono text-base ${FOCUS_RING}`}
                >
                  {label}
                </button>
              );
            }
            const word = row.kind === "too-soon" ? "too soon" : nonStartableWord(row.cell);
            return (
              <div
                key={row.cell.startsAt}
                style={riseDelay(index)}
                className="anim-rise text-muted-foreground flex h-14 flex-col items-center justify-center rounded-(--radius)"
              >
                <span className="font-mono text-base line-through">{label}</span>
                <span className="text-xs">{word}</span>
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

/* Screen 3: "How long?" (DESIGN.md section 3). Tapping a length creates the
   hold -- milestone-3-spec.md section 5, "every hold in this app originates
   in a click", never in an effect on mount. */
function PickLengthScreen({
  station,
  startLabel,
  options,
  pendingHours,
  holdError,
  onBack,
  onPick,
}: {
  station: StationSummary;
  startLabel: string;
  options: LengthOption[];
  pendingHours: number | null;
  holdError: unknown;
  onBack: () => void;
  onPick: (option: LengthOption) => void;
}) {
  return (
    <PageShell>
      <StepHeading step="Step 3 of 4" title="How long?" onBack={onBack} />
      <p className="anim-rise text-muted-foreground text-sm">
        {station.name}, starting {startLabel}
      </p>
      {holdError ? <ErrorNotice error={holdError} /> : null}
      <div className="flex flex-col gap-2.5">
        {options.map((option, index) => {
          const hourWord = option.hours === 1 ? "1 hour" : `${option.hours} hours`;
          if (!option.available) {
            return (
              <div
                key={option.hours}
                style={riseDelay(index)}
                className="anim-rise text-muted-foreground flex h-16 items-center justify-between rounded-(--radius) px-4"
              >
                <span className="text-base line-through">{hourWord}</span>
                <span className="text-sm">{option.blockedFromLabel ? `taken from ${option.blockedFromLabel}` : "taken"}</span>
              </div>
            );
          }
          const selected = option.hours === pendingHours;
          return (
            <button
              key={option.hours}
              type="button"
              disabled={pendingHours !== null}
              aria-pressed={selected}
              onClick={() => onPick(option)}
              style={riseDelay(index)}
              className={
                selected
                  ? `anim-select tile-on flex h-16 items-center justify-between px-4 text-base font-semibold ${FOCUS_RING}`
                  : `anim-rise pressable tile lift flex h-16 items-center justify-between px-4 text-base ${FOCUS_RING}`
              }
            >
              <span className="font-semibold">{hourWord}</span>
              <span className="font-mono font-medium">₹{option.priceRupees}</span>
            </button>
          );
        })}
      </div>
    </PageShell>
  );
}

interface ConfirmState {
  readonly fieldErrors: { readonly name?: string | undefined; readonly contact?: string | undefined };
  readonly panelError: string | null;
}
const INITIAL_CONFIRM_STATE: ConfirmState = { fieldErrors: {}, panelError: null };

/** The five hold fields the attempt record persists, picked from a
 *  CreateHoldResponse. Explicit rather than a spread so a response field the
 *  record does not model can never leak into sessionStorage. */
function holdRecord(hold: CreateHoldResponse): NonNullable<BookingAttempt["hold"]> {
  return {
    holdId: hold.holdId,
    expiresAt: hold.expiresAt,
    ttlSeconds: hold.ttlSeconds,
    quoteMinor: hold.quoteMinor,
    currency: hold.currency,
  };
}

// A syntactically valid but never-verified uuid: used only for the
// pre-OTP local field-validation pass below, never sent to the server (the
// real verificationId, minted by /otp/request and confirmed by
// /otp/verify, replaces it before the body is frozen).
const PLACEHOLDER_VERIFICATION_ID = "00000000-0000-0000-0000-000000000000";

function buildBookingCandidate(attempt: BookingAttempt, name: string, contact: OtpContact, verificationId: string): unknown {
  return {
    stationId: attempt.stationId,
    startsAt: attempt.startsAt,
    slotCount: attempt.slotCount,
    partySize: 1, // DESIGN.md round 3 deleted the party-size field; always 1.
    ...(attempt.hold ? { holdId: attempt.hold.holdId } : {}),
    verificationId,
    // player.phone / player.email are optional on the schema (booking-guardrails-otp-design.v3):
    // whichever channel the player verified with is what goes on the booking.
    player: { name, ...(contact.channel === "email" ? { email: contact.email } : { phone: contact.phone }) },
  };
}

async function releaseAttemptHold(attempt: BookingAttempt): Promise<void> {
  if (!attempt.hold) return;
  await releaseHold({
    holdId: attempt.hold.holdId,
    stationId: attempt.stationId,
    startsAt: attempt.startsAt,
    slotCount: attempt.slotCount,
  }).catch(() => {
    // Best effort; the TTL is the real backstop (docs/conventions/booking-correctness.md).
  });
}

/** Sibling fallback on SLOT_TAKEN (booking-guardrails-otp-design.md, "the
 *  bounce" in docs/booking-flow.md's aggregation gap): the kind's card
 *  promised kind-level availability, but a pick pins one unit. Re-run
 *  pickStationForKind against freshly refetched cells for the SAME kind and
 *  retry the hold on it once, rather than bouncing straight to screen 2.
 *  Never touches the double-booking arbiter -- this only changes which
 *  station the client tries next; the hold and confirm endpoints still
 *  re-verify the exact unit server side. Returns null on no sibling, or a
 *  failed retry hold, so the caller falls back to its existing bounce. */
async function trySiblingHold(
  venue: VenueResponse,
  queryClient: QueryClient,
  date: string,
  failedStationId: string,
  startsAt: string,
  slotCount: number,
): Promise<{ station: StationSummary; hold: CreateHoldResponse } | null> {
  const failedStation = venue.stations.find((candidate) => candidate.id === failedStationId);
  if (!failedStation) return null;
  const siblings = venue.stations.filter((candidate) => candidate.kind === failedStation.kind);

  let fresh;
  try {
    fresh = await queryClient.fetchQuery(availabilityOptions(date, undefined, false));
  } catch {
    return null;
  }
  const target = pickStationForKind(siblings, fresh.cells);
  if (!target || target.id === failedStationId) return null;

  try {
    const hold = await createHold({ stationId: target.id, startsAt, slotCount });
    return { station: target, hold };
  } catch {
    return null;
  }
}

/* Screen 4: "Your details" (DESIGN.md section 4). Four mutually exclusive
   reload states from classifyReload, plus the frozen-body confirm flow from
   milestone-3-spec.md section 5. Its own component so the countdown ticker
   and the hold's release-on-unmount effect are scoped to exactly the
   lifetime this screen is mounted for. */
function DetailsScreen({
  venue,
  date,
  station,
  cells,
  gridMinutes,
  timezone,
  stationId,
  startsAt,
  slotCount,
  startLabel,
  onPickAnotherTime,
  onBackToLength,
}: {
  venue: VenueResponse;
  date: string;
  station: StationSummary;
  cells: AvailabilityCell[];
  gridMinutes: number;
  timezone: string;
  stationId: string;
  startsAt: string;
  slotCount: number;
  startLabel: string;
  onPickAnotherTime: () => void;
  onBackToLength: () => void;
}) {
  const navigate = useNavigate();
  const queryClient: QueryClient = useQueryClient();
  const routeParams: RouteBookingParams = { stationId, startsAt, slotCount };

  const [attempt, setAttempt] = useState<BookingAttempt | null>(() => readAttempt());
  const attemptRef = useRef(attempt);
  // Contact channel (booking-guardrails-otp-design.v3): a resumed frozen
  // body already committed to one channel, so reopening this screen keeps
  // it selected rather than defaulting back to sms.
  const [channel, setChannel] = useState<OtpChannel>(() => (attempt?.submitted?.player.email ? "email" : "sms"));
  // Timer id of a release scheduled by an effect teardown, so a StrictMode
  // remount can cancel it before it fires. Survives the remount because a
  // ref belongs to the component instance, which StrictMode reuses.
  const pendingReleaseRef = useRef<number | null>(null);
  useEffect(() => {
    attemptRef.current = attempt;
  }, [attempt]);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    const onVisible = () => setNowMs(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Releasing the hold: reliable on in-app unmount (back, "Pick another
  // time", a Link elsewhere), best effort on tab close/reload via
  // `pagehide` with `keepalive` (milestone-3-spec.md section 5). Both read
  // the ref, not `attempt` directly, so they see whatever the latest value
  // is rather than what was captured when this effect first ran.
  useEffect(() => {
    const onPageHide = () => {
      const current = attemptRef.current;
      if (!current?.hold) return;
      releaseHoldBeacon({
        holdId: current.hold.holdId,
        stationId: current.stationId,
        startsAt: current.startsAt,
        slotCount: current.slotCount,
      });
    };
    document.addEventListener("pagehide", onPageHide);

    // A pending release from a previous teardown means this is a remount,
    // not a real exit: cancel it. React 19 StrictMode mounts every effect,
    // tears it down, and mounts it again in development, so a cleanup that
    // released immediately killed the hold the moment this screen appeared
    // -- arriving from screen 3, where the hold already exists at mount,
    // the booking was dead before the form rendered. Deferring by a task
    // and cancelling on remount makes the two cases distinguishable: a real
    // unmount has nothing left to cancel it, so the release still fires.
    if (pendingReleaseRef.current !== null) {
      window.clearTimeout(pendingReleaseRef.current);
      pendingReleaseRef.current = null;
    }

    return () => {
      document.removeEventListener("pagehide", onPageHide);
      const current = attemptRef.current;
      if (!current?.hold) return;
      pendingReleaseRef.current = window.setTimeout(() => {
        pendingReleaseRef.current = null;
        void releaseAttemptHold(current);
      }, 0);
    };
  }, []);

  const holdMutation = useMutation({
    mutationFn: createHold,
    onSettled: () => invalidateAvailability(queryClient),
  });

  const [holdActionError, setHoldActionError] = useState<unknown>(null);
  const [serverExpired, setServerExpired] = useState(false);

  // OTP panel state (booking-guardrails-otp-design.v3 pivot: OTP verifies
  // EVERY confirm now, hold or not). otpChallenge is non-null exactly while
  // the code input is showing in place of the "Book" button. pendingDetails
  // holds the name/phone from the details form while the code panel is up,
  // so the real verificationId can be folded into the frozen body once
  // /otp/verify confirms it -- the body can't be built (verificationId is a
  // required field) until then.
  const [otpChallenge, setOtpChallenge] = useState<{
    devCode: string | undefined;
    verificationId: string;
    channel: OtpChannel;
  } | null>(null);
  const pendingDetailsRef = useRef<{ name: string; contact: OtpContact } | null>(null);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpVerifyError, setOtpVerifyError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(INITIAL_CONFIRM_STATE);
  const [confirming, setConfirming] = useState(false);

  const rawCase = classifyReload(attempt, routeParams, nowMs);
  const reloadCase = serverExpired && rawCase.kind === "resume" ? ({ kind: "expired" } as const) : rawCase;

  // Announcements at 60s/20s/0 (milestone-3-spec.md section 5), each guarded
  // so a resumed tab that jumps from 180s to 0s announces once, not three.
  const announced60 = useRef(false);
  const announced20 = useRef(false);
  const announced0 = useRef(false);
  const [liveMessage, setLiveMessage] = useState("");
  useEffect(() => {
    if (reloadCase.kind !== "resume") return;
    const { remainingMs } = countdownState(reloadCase.hold.expiresAt, nowMs);
    if (remainingMs <= 0 && !announced0.current) {
      announced0.current = true;
      setLiveMessage("Your hold has expired.");
    } else if (remainingMs <= 20_000 && !announced20.current) {
      announced20.current = true;
      setLiveMessage("Twenty seconds left on your hold.");
    } else if (remainingMs <= 60_000 && !announced60.current) {
      announced60.current = true;
      setLiveMessage("One minute left on your hold.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowMs, reloadCase.kind]);

  function resetAnnouncements() {
    announced60.current = false;
    announced20.current = false;
    announced0.current = false;
  }

  // milestone-3-spec.md section 5: "if a mismatched record exists ... fire a
  // release for the old range before overwriting the record." Mirrors
  // handlePick's same rule in screen 3.
  async function releaseIfMismatched(target: RouteBookingParams) {
    const previous = attemptRef.current;
    const sameRequest =
      previous?.stationId === target.stationId &&
      previous.startsAt === target.startsAt &&
      previous.slotCount === target.slotCount;
    if (previous && !sameRequest) await releaseAttemptHold(previous);
  }

  async function handleFreshHold() {
    setHoldActionError(null);
    await releaseIfMismatched(routeParams);
    const fresh: BookingAttempt = {
      idempotencyKey: crypto.randomUUID(),
      stationId,
      startsAt,
      slotCount,
      hold: null,
      submitted: null,
      outcomeUnknown: false,
    };
    writeAttempt(fresh);
    setAttempt(fresh);
    resetAnnouncements();
    setServerExpired(false);
    try {
      const hold = await holdMutation.mutateAsync({ stationId, startsAt, slotCount });
      const withHold: BookingAttempt = { ...fresh, hold: holdRecord(hold) };
      writeAttempt(withHold);
      setAttempt(withHold);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "HOLD_UNAVAILABLE") return; // stays degraded, fresh already has hold: null
      if (err instanceof ApiRequestError && errorPresentation[err.code].recovery === "refetch-and-pick") {
        clearAttempt();
        setAttempt(null);
        toast(errorPresentation[err.code].title, { description: err.message || errorPresentation[err.code].detail });
        navigate({ to: "/book" });
        return;
      }
      clearAttempt();
      setAttempt(null);
      setHoldActionError(err);
    }
  }

  async function handleRehold() {
    const current = attemptRef.current;
    if (!current) return handleFreshHold();
    setHoldActionError(null);
    try {
      const hold = await holdMutation.mutateAsync({ stationId: current.stationId, startsAt: current.startsAt, slotCount: current.slotCount });
      const next: BookingAttempt = { ...current, hold: holdRecord(hold) };
      writeAttempt(next);
      setAttempt(next);
      resetAnnouncements();
      setServerExpired(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "HOLD_UNAVAILABLE") {
        const degraded: BookingAttempt = { ...current, hold: null };
        writeAttempt(degraded);
        setAttempt(degraded);
        setServerExpired(false);
        return;
      }
      if (err instanceof ApiRequestError && errorPresentation[err.code].recovery === "refetch-and-pick") {
        clearAttempt();
        setAttempt(null);
        invalidateAvailability(queryClient);
        toast(errorPresentation[err.code].title, { description: err.message || errorPresentation[err.code].detail });
        navigate({ to: "/book" });
        return;
      }
      setHoldActionError(err);
    }
  }

  // The actual confirm call, shared by the direct-degraded path, the
  // post-verify path, and the sibling retry on a confirm-time SLOT_TAKEN --
  // one place owns "what happens after createBooking answers."
  async function doConfirm(body: CreateBookingRequest, current: BookingAttempt): Promise<void> {
    try {
      const booking = await createBooking(body, current.idempotencyKey);
      queryClient.setQueryData(keys.booking(booking.id), booking);
      invalidateAvailability(queryClient);
      clearAttempt();
      setAttempt(null);
      navigate({
        to: "/booking/$bookingId",
        params: { bookingId: booking.id },
        search: { code: booking.confirmationCode },
        replace: true,
      });
      setConfirmState(INITIAL_CONFIRM_STATE);
      return;
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "HOLD_EXPIRED") {
          setServerExpired(true);
          return;
        }
        if (err.code === "SLOT_TAKEN") {
          // Sibling fallback (booking-guardrails-otp-design.md): the same
          // kind may still have a free unit even though this exact one was
          // just claimed. One retry, on a fresh hold, before bouncing.
          const sibling = await trySiblingHold(venue, queryClient, date, current.stationId, current.startsAt, current.slotCount);
          if (sibling) {
            const siblingBody: CreateBookingRequest = { ...body, stationId: sibling.station.id, holdId: sibling.hold.holdId };
            const siblingAttempt: BookingAttempt = {
              idempotencyKey: crypto.randomUUID(),
              stationId: sibling.station.id,
              startsAt: current.startsAt,
              slotCount: current.slotCount,
              hold: holdRecord(sibling.hold),
              submitted: siblingBody,
              outcomeUnknown: false,
            };
            writeAttempt(siblingAttempt);
            setAttempt(siblingAttempt);
            return doConfirm(siblingBody, siblingAttempt);
          }
        }
        if (errorPresentation[err.code].recovery === "refetch-and-pick") {
          clearAttempt();
          setAttempt(null);
          invalidateAvailability(queryClient);
          toast(errorPresentation[err.code].title, { description: err.message || errorPresentation[err.code].detail });
          navigate({ to: "/book" });
          setConfirmState(INITIAL_CONFIRM_STATE);
          return;
        }
        if (err.code === "IDEMPOTENCY_KEY_REUSED") {
          // Client bug: the frozen-body rule was violated. Fresh key, clear
          // the frozen body, let the user submit again.
          const fresh: BookingAttempt = { ...current, idempotencyKey: crypto.randomUUID(), submitted: null };
          writeAttempt(fresh);
          setAttempt(fresh);
          setConfirmState({ fieldErrors: {}, panelError: "Something went wrong. Please try again." });
          return;
        }
        if (err.code === "VALIDATION_FAILED" || err.code === "PARTY_SIZE_EXCEEDS_CAPACITY") {
          // Safe to unlock: unfreeze so a corrected resubmit sends fresh input.
          const unfrozen: BookingAttempt = { ...current, submitted: null };
          writeAttempt(unfrozen);
          setAttempt(unfrozen);
          const { name: nameError, phone, email, panel } = playerFieldErrors(err.details);
          const contactError = body.player.email ? email : phone;
          setConfirmState({
            fieldErrors: { name: nameError, contact: contactError },
            panelError: panel ?? (err.message || errorPresentation[err.code].detail),
          });
          return;
        }
        if (err.code === "OTP_REQUIRED") {
          // Defensive: this flow always verifies before confirming. Reached
          // only by a race (the hold got swapped out from under a verified
          // challenge) -- start the hold over rather than loop with nothing
          // left on this screen to retry.
          setServerExpired(true);
          return;
        }
        // Everything else (IDEMPOTENCY_KEY_REQUIRED, REQUEST_IN_FLIGHT,
        // RATE_LIMITED, BOOKING_TIMEOUT, INTERNAL, ...): stays frozen, panel
        // error, "Try again" resends the same key and body.
        setConfirmState({ fieldErrors: {}, panelError: err.message || errorPresentation[err.code].detail });
        return;
      }
      if (err instanceof NetworkError) {
        if (err.outcomeUnknown) {
          const locked: BookingAttempt = { ...current, outcomeUnknown: true };
          writeAttempt(locked);
          setAttempt(locked);
        }
        setConfirmState({
          fieldErrors: {},
          panelError: err.outcomeUnknown
            ? "Your earlier attempt may have gone through. If you get a second confirmation, cancel one."
            : "Could not reach the server. Check your connection.",
        });
        return;
      }
      setConfirmState({ fieldErrors: {}, panelError: "Something went wrong. Please try again." });
    }
  }

  // The "Book for ..." submit: freezes the body exactly as before, then
  // Always requests an OTP challenge and swaps in the code panel: the OTP
  // pivot (2026-09-23 design v3) requires verification on EVERY confirm,
  // hold or not. A retry (current.submitted already frozen with a real,
  // still-unconsumed verificationId -- SLOT_TAKEN doesn't consume it, only
  // a committed confirm does) skips straight back to doConfirm.
  async function handleDetailsSubmit(formData: FormData) {
    setConfirming(true);
    try {
      const current = attemptRef.current;
      if (!current) {
        setConfirmState({ fieldErrors: {}, panelError: "Something went wrong on our side." });
        return;
      }

      if (current.submitted) {
        // Frozen on an earlier pass: every retry sends this verbatim, never
        // a re-read of the form (milestone-3-spec.md section 5).
        await doConfirm(current.submitted, current);
        return;
      }

      const name = String(formData.get("name") ?? "").trim();
      const contactChannel: OtpChannel = formData.get("channel") === "email" ? "email" : "sms";
      const rawContact = String(formData.get("contact") ?? "").trim();
      // Reuses the server's own contact schema (packages/engine/contracts/otp)
      // rather than a hand-rolled regex: same India-phone pattern, same
      // email shape, same normalization (lowercased email, last-10-digit
      // phone), so a UX-only pre-check never drifts from what /otp/request
      // will actually accept.
      const contactParse = otpContactSchema.safeParse(
        contactChannel === "email" ? { channel: "email", email: rawContact } : { channel: "sms", phone: rawContact },
      );
      if (!contactParse.success) {
        const message =
          contactChannel === "email" ? "Enter a valid email address." : "Enter a 10-digit Indian mobile number, starting 6-9.";
        setConfirmState({ fieldErrors: { contact: message }, panelError: null });
        return;
      }
      const contact = contactParse.data;

      // Local pre-check only (placeholder verificationId): catches a bad
      // name/contact before ever calling /otp/request. The real body is
      // built and validated again in handleVerifySubmit, once a verified
      // verificationId exists to put in it.
      const precheck = createBookingRequestSchema.safeParse(
        buildBookingCandidate(current, name, contact, PLACEHOLDER_VERIFICATION_ID),
      );
      if (!precheck.success) {
        const { name: nameError, phone, email, panel } = playerFieldErrors(precheck.error.flatten());
        setConfirmState({ fieldErrors: { name: nameError, contact: contact.channel === "email" ? email : phone }, panelError: panel });
        return;
      }
      pendingDetailsRef.current = { name, contact };

      try {
        const otpRes = await requestOtp({ contact });
        setOtpVerifyError(null);
        setOtpChallenge({ devCode: otpRes.devCode, verificationId: otpRes.verificationId, channel: contact.channel });
        setConfirmState(INITIAL_CONFIRM_STATE);
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === "HOLD_EXPIRED") {
          setServerExpired(true);
          return;
        }
        if (err instanceof ApiRequestError) {
          setConfirmState({ fieldErrors: {}, panelError: err.message || errorPresentation[err.code].detail });
          return;
        }
        if (err instanceof NetworkError) {
          setConfirmState({
            fieldErrors: {},
            panelError: err.outcomeUnknown
              ? "Your earlier attempt may have gone through. If you get a second confirmation, cancel one."
              : "Could not reach the server. Check your connection.",
          });
          return;
        }
        setConfirmState({ fieldErrors: {}, panelError: "Something went wrong. Please try again." });
      }
    } finally {
      setConfirming(false);
    }
  }

  // The code-entry submit. On a verified code, builds the real body (now
  // that a verified verificationId exists), freezes it, and hands off to
  // doConfirm.
  async function handleVerifySubmit(formData: FormData) {
    const current = attemptRef.current;
    const details = pendingDetailsRef.current;
    if (!current || !otpChallenge || !details) return;
    const code = String(formData.get("code") ?? "").trim();
    setOtpVerifying(true);
    setOtpVerifyError(null);
    try {
      const result = await verifyOtp({ verificationId: otpChallenge.verificationId, code });
      if (result.verified) {
        const parsed = createBookingRequestSchema.safeParse(
          buildBookingCandidate(current, details.name, details.contact, otpChallenge.verificationId),
        );
        setOtpChallenge(null);
        if (!parsed.success) {
          const { name: nameError, phone, email, panel } = playerFieldErrors(parsed.error.flatten());
          setConfirmState({
            fieldErrors: { name: nameError, contact: details.contact.channel === "email" ? email : phone },
            panelError: panel,
          });
          return;
        }
        const frozen: BookingAttempt = { ...current, submitted: parsed.data };
        writeAttempt(frozen);
        setAttempt(frozen);
        await doConfirm(parsed.data, frozen);
      }
    } catch (err) {
      if (err instanceof ApiRequestError && (err.code === "OTP_EXPIRED" || err.code === "HOLD_EXPIRED")) {
        setOtpChallenge(null);
        setServerExpired(true);
        return;
      }
      if (err instanceof ApiRequestError && err.code === "OTP_INVALID") {
        setOtpVerifyError("Wrong code. Try again.");
        return;
      }
      if (err instanceof ApiRequestError && err.code === "OTP_TOO_MANY") {
        const presentation = errorPresentation.OTP_TOO_MANY;
        toast(presentation.title, { description: err.message || presentation.detail });
        setOtpVerifyError(err.message || presentation.detail);
        return;
      }
      if (err instanceof ApiRequestError) {
        setOtpVerifyError(err.message || errorPresentation[err.code].detail);
        return;
      }
      setOtpVerifyError("Could not reach the server. Check your connection.");
    } finally {
      setOtpVerifying(false);
    }
  }

  function handleStartOver() {
    clearAttempt();
    setAttempt(null);
    navigate({ to: "/book" });
  }

  const endLabel = endTimeLabel(cells, startsAt, slotCount, timezone);
  const hours = (slotCount * gridMinutes) / 60;
  const hourWord = hours === 1 ? "1 hour" : `${hours} hours`;
  const priceRupees = attempt?.hold ? attempt.hold.quoteMinor / 100 : bookingPriceRupees(station, gridMinutes, slotCount);
  const estimated = !attempt?.hold;
  const countdown = reloadCase.kind === "resume" ? countdownState(reloadCase.hold.expiresAt, nowMs) : null;

  // The ticket stub, unissued: the same object screen 5 issues, minus the
  // cap rule (DESIGN.md Imagery, round-6 remainder).
  const recap = (
    <div style={riseDelay(1)} className="anim-rise stub flex flex-col gap-1 p-6">
      <p className="font-display text-xl uppercase tracking-wide">{station.name}</p>
      <div className="stub-perf my-3" />
      <p className="text-base">
        Tonight, {startLabel} to {endLabel}
      </p>
      <p className="text-base">
        {hourWord}, <span className="font-mono font-medium">₹{priceRupees}</span>
        {estimated ? " (estimated)" : ""}
      </p>
    </div>
  );

  if (reloadCase.kind === "resume-prompt") {
    return (
      <PageShell>
        <StepHeading step="Step 4 of 4" title="Your details" onBack={onBackToLength} />
        {recap}
        {holdActionError ? <ErrorNotice error={holdActionError} /> : null}
        <button
          type="button"
          disabled={holdMutation.isPending}
          onClick={() => void handleFreshHold()}
          className={`pressable btn-go h-12 rounded-(--radius) text-base font-semibold disabled:opacity-50 ${FOCUS_RING}`}
        >
          {holdMutation.isPending ? "Holding…" : `Hold ${station.name}, ${startLabel} to ${endLabel}`}
        </button>
      </PageShell>
    );
  }

  if (reloadCase.kind === "expired") {
    return (
      <PageShell>
        <StepHeading step="Step 4 of 4" title="Your details" onBack={onBackToLength} />
        {recap}
        <Notice tone="destructive">Your time ran out and someone may have taken the spot.</Notice>
        {holdActionError ? <ErrorNotice error={holdActionError} /> : null}
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            disabled={holdMutation.isPending}
            onClick={() => void handleRehold()}
            className={`pressable btn-go h-12 rounded-(--radius) text-base font-semibold disabled:opacity-50 ${FOCUS_RING}`}
          >
            {holdMutation.isPending ? "Trying…" : "Try again"}
          </button>
          <button
            type="button"
            onClick={onPickAnotherTime}
            className={`text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4 transition-colors ${FOCUS_RING}`}
          >
            Pick another time
          </button>
        </div>
      </PageShell>
    );
  }

  // reloadCase.kind is "resume" or "degraded" here: the full form.
  const disabled = confirming || otpVerifying || otpChallenge !== null || (attempt?.outcomeUnknown ?? false);
  return (
    <PageShell>
      <StepHeading step="Step 4 of 4" title="Your details" onBack={onBackToLength} />
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
      {recap}
      {reloadCase.kind === "degraded" ? (
        <Notice>
          We could not reserve this slot while you fill in your details. Someone else may confirm first. Your
          booking is only certain once you press Confirm.
        </Notice>
      ) : null}
      {confirmState.panelError ? <Notice tone="destructive">{confirmState.panelError}</Notice> : null}
      <form action={(formData: FormData) => void handleDetailsSubmit(formData)} style={riseDelay(2)} className="anim-rise flex flex-col gap-3">
        <TextField
          id="details-name"
          label="Name"
          name="name"
          placeholder="Your name"
          required
          disabled={disabled}
          defaultValue={attempt?.submitted?.player.name}
          aria-invalid={confirmState.fieldErrors.name ? true : undefined}
        />
        {confirmState.fieldErrors.name ? <p className="text-destructive text-sm">{confirmState.fieldErrors.name}</p> : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm leading-none font-medium">Contact</span>
          <div role="group" aria-label="Contact method" className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              aria-pressed={channel === "email"}
              disabled={disabled}
              onClick={() => setChannel("email")}
              className={
                channel === "email"
                  ? `pressable tile-on h-11 text-sm font-semibold ${FOCUS_RING}`
                  : `pressable tile lift h-11 text-sm ${FOCUS_RING}`
              }
            >
              Email
            </button>
            <button
              type="button"
              aria-pressed={channel === "sms"}
              disabled={disabled}
              onClick={() => setChannel("sms")}
              className={
                channel === "sms"
                  ? `pressable tile-on h-11 text-sm font-semibold ${FOCUS_RING}`
                  : `pressable tile lift h-11 text-sm ${FOCUS_RING}`
              }
            >
              SMS
            </button>
          </div>
        </div>
        <input type="hidden" name="channel" value={channel} />
        {channel === "email" ? (
          <TextField
            id="details-contact"
            label="Email"
            name="contact"
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            required
            disabled={disabled}
            defaultValue={attempt?.submitted?.player.email}
            aria-invalid={confirmState.fieldErrors.contact ? true : undefined}
          />
        ) : (
          <TextField
            id="details-contact"
            label="Phone"
            name="contact"
            type="tel"
            inputMode="tel"
            placeholder="98765 43210"
            required
            disabled={disabled}
            defaultValue={attempt?.submitted?.player.phone}
            aria-invalid={confirmState.fieldErrors.contact ? true : undefined}
          />
        )}
        {confirmState.fieldErrors.contact ? <p className="text-destructive text-sm">{confirmState.fieldErrors.contact}</p> : null}
        {otpChallenge ? null : (
          <button
            type="submit"
            disabled={disabled}
            className={`pressable btn-go mt-2 h-12 rounded-(--radius) text-base font-semibold disabled:opacity-50 ${FOCUS_RING}`}
          >
            {confirming ? "Booking…" : `Book for ₹${priceRupees}`}
          </button>
        )}
        {attempt?.outcomeUnknown ? (
          <div className="flex flex-col gap-2">
            <button
              type="submit"
              disabled={confirming}
              className={`text-muted-foreground hover:text-foreground self-center text-sm underline underline-offset-4 transition-colors disabled:opacity-50 ${FOCUS_RING}`}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={handleStartOver}
              className={`text-destructive self-center text-sm underline underline-offset-4 transition-colors ${FOCUS_RING}`}
            >
              Start over
            </button>
          </div>
        ) : countdown ? (
          <p className={`text-center text-sm ${countdown.urgent ? "text-destructive" : "text-muted-foreground"}`}>
            {countdown.urgent ? "Hurry, this" : "This"} spot is yours for the next{" "}
            <span className="font-mono">{countdown.label}</span>
          </p>
        ) : null}
      </form>
      {otpChallenge ? (
        <div style={riseDelay(3)} className="anim-rise flex flex-col gap-3">
          <Notice>
            We sent a 6-digit code to your {otpChallenge.channel === "email" ? "email" : "phone"}.
            {otpChallenge.devCode ? (
              <>
                {" "}
                Mock code, dev only: <span className="font-mono font-semibold">{otpChallenge.devCode}</span>
              </>
            ) : null}
          </Notice>
          {otpVerifyError ? <Notice tone="destructive">{otpVerifyError}</Notice> : null}
          <form action={(formData: FormData) => void handleVerifySubmit(formData)} className="flex flex-col gap-3">
            <TextField
              id="details-otp-code"
              label="Code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              required
              disabled={otpVerifying}
            />
            <button
              type="submit"
              disabled={otpVerifying}
              className={`pressable btn-go h-12 rounded-(--radius) text-base font-semibold disabled:opacity-50 ${FOCUS_RING}`}
            >
              {otpVerifying ? "Verifying…" : "Verify and book"}
            </button>
          </form>
        </div>
      ) : null}
    </PageShell>
  );
}

function BookStationScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { stationId } = bookStationRoute.useParams();
  const search = bookStationRoute.useSearch();
  const [pendingHours, setPendingHours] = useState<number | null>(null);
  const [holdError, setHoldError] = useState<unknown>(null);
  // A stable "now" for the too-soon (lead time) split below -- read once
  // per mount, not called directly during render (react-hooks/purity).
  const [nowMs] = useState(() => Date.now());

  const venueQuery = useQuery(venueOptions());
  const venue = venueQuery.data;
  // The date strip (screen 1) picks the night; screen 2-4 read it back so a
  // console picked for Friday stays on Friday's grid, falling back to
  // tonight when nothing was picked (a direct link, or storage cleared).
  const date = venue ? (readSelectedDate() ?? currentBusinessDate(venue, new Date())) : undefined;
  // Availability polling pauses once a hold exists (slots set): the same
  // reasoning as the hold panel in milestone-3-spec.md section 4.
  const availabilityQuery = useQuery({
    ...availabilityOptions(date ?? "", undefined, search.slots !== undefined),
    enabled: date !== undefined,
  });

  const createHoldMutation = useMutation({
    mutationFn: createHold,
    onSettled: () => invalidateAvailability(queryClient),
  });

  const onBackToTime = () =>
    navigate({ to: "/book/$stationId", params: { stationId }, search: {} });
  const onBackToStation = () => navigate({ to: "/book" });
  const onBackToLength = () =>
    navigate({ to: "/book/$stationId", params: { stationId }, search: { start: search.start } });

  if (venueQuery.isError) {
    return (
      <PageShell>
        <StepHeading step="Step 2 of 4" title="Pick a start time" onBack={onBackToStation} />
        <ErrorNotice error={venueQuery.error} />
      </PageShell>
    );
  }

  if (!venue || availabilityQuery.isPending) {
    return <SkeletonScreen step={search.start === undefined ? "Step 2 of 4" : "Step 3 of 4"} rows={9} />;
  }

  const station = venue.stations.find((candidate) => candidate.id === stationId);
  if (!station) {
    return (
      <PageShell>
        <StepHeading step="Step 2 of 4" title="Pick a start time" onBack={onBackToStation} />
        <Notice>That console does not exist.</Notice>
      </PageShell>
    );
  }

  if (availabilityQuery.isError) {
    return (
      <PageShell>
        <StepHeading step="Step 2 of 4" title="Pick a start time" onBack={onBackToStation} />
        <ErrorNotice error={availabilityQuery.error} />
      </PageShell>
    );
  }

  const availability = availabilityQuery.data;
  if (!availability) return null; // exhausts pending/error/success

  const cells = cellsByStation(availability.cells, stationId);

  // Screen 2: no start chosen yet. Rows include both real startable/taken
  // cells and cells the server excluded for starting too soon (lead time) --
  // see leadBlockedCells/timeCellRows in lib/stations.ts.
  if (search.start === undefined) {
    const rows = timeCellRows(cells, station.minSlots, nowMs);
    return (
      <PickTimeScreen
        station={station}
        rows={rows}
        onBack={onBackToStation}
        onPick={(startsAt) =>
          navigate({ to: "/book/$stationId", params: { stationId }, search: { start: startsAt } })
        }
      />
    );
  }

  const startCell = cells.find((cell) => cell.startsAt === search.start);
  if (!startCell) {
    // Stale or hand-edited link: the instant no longer matches a cell on
    // tonight's grid. Send the user back to pick a real start rather than
    // rendering a screen with nothing to recap.
    return (
      <PageShell>
        <StepHeading step="Step 2 of 4" title="Pick a start time" onBack={onBackToStation} />
        <Notice>That start time is no longer available.</Notice>
      </PageShell>
    );
  }
  const startLabel = timeLabelOf(startCell);

  // Screen 4: a length was already picked (a hold exists, or degraded).
  if (search.slots !== undefined) {
    return (
      <DetailsScreen
        venue={venue}
        date={date ?? ""}
        station={station}
        cells={cells}
        gridMinutes={availability.gridMinutes}
        timezone={venue.timezone}
        stationId={stationId}
        startsAt={search.start}
        slotCount={search.slots}
        startLabel={startLabel}
        onPickAnotherTime={onBackToTime}
        onBackToLength={onBackToLength}
      />
    );
  }

  // Screen 3: pick a length, which creates the hold on tap.
  const options = lengthOptionsForStart(cells, search.start, station, availability.gridMinutes);

  // The start matches a real cell, but that cell can no longer begin a
  // booking. Screen 2 never offers such a start, so this is the aged-link
  // case: the tab sat open, or the URL was shared, until the start went
  // past or somebody took it. Say which, in words, and point back at the
  // time grid -- DESIGN.md keeps "taken" for someone else's booking, so a
  // start that merely expired must not borrow that word.
  if (options.length === 0) {
    const state = startCellState(cells, search.start);
    const reason =
      state === CELL_STATES.PAST
        ? "That start time has already passed."
        : state === CELL_STATES.BOOKED
          ? "That time was booked by someone else."
          : state === CELL_STATES.HELD
            ? "Someone else is holding that time right now."
            : state === CELL_STATES.MAINTENANCE
              ? "That console is being fixed."
              : "That start time is no longer available.";
    return (
      <PageShell>
        <StepHeading step="Step 2 of 4" title="Pick a start time" onBack={onBackToStation} />
        <Notice>{reason}</Notice>
        <button
          type="button"
          onClick={onBackToTime}
          className={`text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4 transition-colors ${FOCUS_RING}`}
        >
          Pick another time
        </button>
      </PageShell>
    );
  }

  async function handlePick(option: LengthOption) {
    setHoldError(null);
    setPendingHours(option.hours);

    // milestone-3-spec.md section 5: if a mismatched attempt is already in
    // sessionStorage (the user was mid-flow on a different range), release
    // its hold before overwriting the record -- the one place a release
    // fires for something other than the current route.
    const previous = readAttempt();
    const isSameRequest =
      previous?.stationId === stationId && previous.startsAt === search.start && previous.slotCount === option.slotCount;
    if (previous && !isSameRequest) void releaseAttemptHold(previous);

    // The idempotency key is created once, in the same statement that
    // writes the attempt record, before the hold request is sent. It is
    // reused on every later retry of the eventual confirm.
    const attempt: BookingAttempt = {
      idempotencyKey: crypto.randomUUID(),
      stationId,
      startsAt: search.start as string,
      slotCount: option.slotCount,
      hold: null,
      submitted: null,
      outcomeUnknown: false,
    };
    writeAttempt(attempt);

    try {
      const hold = await createHoldMutation.mutateAsync({
        stationId,
        startsAt: attempt.startsAt,
        slotCount: option.slotCount,
      });
      writeAttempt({ ...attempt, hold: holdRecord(hold) });
      advanceAfterBeat(() =>
        navigate({
          to: "/book/$stationId",
          params: { stationId },
          search: { start: search.start, slots: option.slotCount },
        }),
      );
    } catch (err) {
      // Degraded mode (section 9): HOLD_UNAVAILABLE is not a failure to
      // book. The attempt record already has hold: null; proceed anyway.
      if (err instanceof ApiRequestError && err.code === "HOLD_UNAVAILABLE") {
        advanceAfterBeat(() =>
          navigate({
            to: "/book/$stationId",
            params: { stationId },
            search: { start: search.start, slots: option.slotCount },
          }),
        );
        return;
      }
      // SLOT_TAKEN / SLOT_HELD: the kind's card promised kind-level
      // availability but this pick pinned one unit (docs/booking-flow.md's
      // aggregation gap). Try the next free sibling of the same kind once,
      // before giving up the attempt and bouncing.
      if (err instanceof ApiRequestError && (err.code === "SLOT_TAKEN" || err.code === "SLOT_HELD") && venue) {
        const sibling = await trySiblingHold(venue, queryClient, date ?? "", stationId, attempt.startsAt, option.slotCount);
        if (sibling) {
          writeAttempt({
            idempotencyKey: attempt.idempotencyKey,
            stationId: sibling.station.id,
            startsAt: attempt.startsAt,
            slotCount: option.slotCount,
            hold: holdRecord(sibling.hold),
            submitted: null,
            outcomeUnknown: false,
          });
          advanceAfterBeat(() =>
            navigate({
              to: "/book/$stationId",
              params: { stationId: sibling.station.id },
              search: { start: attempt.startsAt, slots: option.slotCount },
            }),
          );
          return;
        }
      }

      // No hold exists for this attempt: abandon it so a retry starts
      // clean with a fresh key (rule 2's "the user deliberately changes
      // the request" case, forced by the failure).
      clearAttempt();
      setPendingHours(null);

      // SLOT_TAKEN / SLOT_HELD (and the other "refetch-and-pick" codes):
      // someone beat the user to this range, and no sibling covered it
      // either. Not recoverable by retrying the same tap --
      // invalidateAvailability already ran via onSettled, so send them
      // back to pick a different time rather than leaving them staring at
      // stale length buttons. The toast has to fire before the navigation:
      // this screen unmounts on the way out, so any state set here would
      // never render, and a silent bounce back to the time grid is the one
      // moment the user most needs the words. Toast, not a Notice, because
      // errorPresentation says surface: "toast" for these codes, and
      // root.tsx already mounts the Sonner <Toaster/>. The server's
      // message names the conflicting range, so it wins over the generic
      // detail when present (errorPresentation's own note).
      if (err instanceof ApiRequestError && errorPresentation[err.code].recovery === "refetch-and-pick") {
        const presentation = errorPresentation[err.code];
        toast(presentation.title, { description: err.message || presentation.detail });
        onBackToTime();
        return;
      }
      setHoldError(err);
    }
  }

  return (
    <PickLengthScreen
      station={station}
      startLabel={startLabel}
      options={options}
      pendingHours={pendingHours}
      holdError={holdError}
      onBack={onBackToTime}
      onPick={(option) => void handlePick(option)}
    />
  );
}

export const bookStationRoute = createRoute({
  getParentRoute: () => bookRoute,
  path: "$stationId",
  validateSearch: (search) => searchSchema.parse(search),
  component: BookStationScreen,
});
