import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { Square } from "lucide-react";
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
import { currentBusinessDate, businessDateLabel } from "../lib/business-date.js";
import { countdownState, formatCountdown } from "../lib/countdown.js";
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
  ownHoldOf,
  readAttempt,
  readSelectedDate,
  writeAttempt,
  type BookingAttempt,
  type RouteBookingParams,
} from "../lib/attempt.js";
import {
  Notice,
  SkeletonBox,
  LoadingScreen,
  TextField,
  FieldError,
  PhoneField,
  ChannelToggle,
  FOCUS_RING,
  UNDERLINE_LINK,
  riseDelay,
  StepHeading,
  advanceAfterBeat,
} from "../components/screen-ui.js";

const searchSchema = z.object({
  start: z.string().optional().catch(undefined),
  slots: z.number().int().positive().optional().catch(undefined),
});

function ErrorNotice({ error }: { error: unknown }) {
  const message =
    error instanceof ApiRequestError ? errorPresentation[error.code].detail : "Something went wrong. Please try again.";
  return <Notice tone="destructive">{message}</Notice>;
}

const OTP_RESEND_COOLDOWN_MS = 30_000;

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
  const [pickedStart, setPickedStart] = useState<string | null>(null);
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
                  disabled={pickedStart !== null}
                  aria-pressed={row.cell.startsAt === pickedStart}
                  onClick={() => {
                    setPickedStart(row.cell.startsAt);
                    advanceAfterBeat(() => onPick(row.cell.startsAt));
                  }}
                  style={riseDelay(index)}
                  className={
                    row.cell.startsAt === pickedStart
                      ? `anim-select tile-on h-14 font-mono text-base font-semibold ${FOCUS_RING}`
                      : `anim-rise pressable tile lift h-14 font-mono text-base ${FOCUS_RING}`
                  }
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
              {selected ? (
                <span aria-live="polite" className="late-in flex items-center gap-2 font-medium">
                  <Square aria-hidden="true" fill="currentColor" className="size-3.5 motion-safe:animate-pulse" />
                  Holding…
                </span>
              ) : (
                <span className="font-mono font-medium">₹{option.priceRupees}</span>
              )}
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

function holdRecord(hold: CreateHoldResponse): NonNullable<BookingAttempt["hold"]> {
  return {
    holdId: hold.holdId,
    expiresAt: hold.expiresAt,
    ttlSeconds: hold.ttlSeconds,
    quoteMinor: hold.quoteMinor,
    currency: hold.currency,
  };
}

const PLACEHOLDER_VERIFICATION_ID = "00000000-0000-0000-0000-000000000000";

function buildBookingCandidate(attempt: BookingAttempt, name: string, contact: OtpContact, verificationId: string): unknown {
  return {
    stationId: attempt.stationId,
    startsAt: attempt.startsAt,
    slotCount: attempt.slotCount,
    partySize: 1,
    ...(attempt.hold ? { holdId: attempt.hold.holdId } : {}),
    verificationId,
    player: { name, ...(contact.channel === "email" ? { email: contact.email } : { phone: contact.phone }) },
  };
}

async function releaseAttemptHold(attempt: BookingAttempt, queryClient: QueryClient): Promise<void> {
  if (!attempt.hold) return;
  await releaseHold({
    holdId: attempt.hold.holdId,
    stationId: attempt.stationId,
    startsAt: attempt.startsAt,
    slotCount: attempt.slotCount,
  }).catch(() => {
    // Best effort; the TTL is the real backstop (docs/conventions/booking-correctness.md).
  });
  invalidateAvailability(queryClient);
}

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
  const [channel, setChannel] = useState<OtpChannel>(() => (attempt?.submitted?.player.email ? "email" : "sms"));
  const [nameValue, setNameValue] = useState(() => attempt?.submitted?.player.name ?? "");
  const [emailValue, setEmailValue] = useState(() => attempt?.submitted?.player.email ?? "");
  const [phoneValue, setPhoneValue] = useState(() => attempt?.submitted?.player.phone ?? "");
  const [resendAtMs, setResendAtMs] = useState(0);
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
        void releaseAttemptHold(current, queryClient);
      }, 0);
    };
  }, []);

  const holdMutation = useMutation({
    mutationFn: createHold,
    onSettled: () => invalidateAvailability(queryClient),
  });

  const [holdActionError, setHoldActionError] = useState<unknown>(null);
  const [serverExpired, setServerExpired] = useState(false);

  const [otpChallenge, setOtpChallenge] = useState<{
    devCode: string | undefined;
    verificationId: string;
    contact: OtpContact;
  } | null>(null);
  const pendingDetailsRef = useRef<{ name: string; contact: OtpContact } | null>(null);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpVerifyError, setOtpVerifyError] = useState<string | null>(null);
  useEffect(() => {
    if (otpVerifyError) document.getElementById("details-otp-code")?.focus();
  }, [otpVerifyError]);
  const [otpCode, setOtpCode] = useState("");
  const scrollPanelIntoView = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);
  const [confirmState, setConfirmState] = useState<ConfirmState>(INITIAL_CONFIRM_STATE);
  const [confirming, setConfirming] = useState(false);

  const rawCase = classifyReload(attempt, routeParams, nowMs);
  const reloadCase = serverExpired && rawCase.kind === "resume" ? ({ kind: "expired" } as const) : rawCase;

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

  async function releaseIfMismatched(target: RouteBookingParams) {
    const previous = attemptRef.current;
    const sameRequest =
      previous?.stationId === target.stationId &&
      previous.startsAt === target.startsAt &&
      previous.slotCount === target.slotCount;
    if (previous && !sameRequest) await releaseAttemptHold(previous, queryClient);
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
      if (err instanceof ApiRequestError && err.code === "HOLD_UNAVAILABLE") return;
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
          const fresh: BookingAttempt = { ...current, idempotencyKey: crypto.randomUUID(), submitted: null };
          writeAttempt(fresh);
          setAttempt(fresh);
          setConfirmState({ fieldErrors: {}, panelError: "Something went wrong. Please try again." });
          return;
        }
        if (err.code === "VALIDATION_FAILED" || err.code === "PARTY_SIZE_EXCEEDS_CAPACITY") {
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
          setServerExpired(true);
          return;
        }
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

  async function issueCode(contact: OtpContact): Promise<void> {
    const otpRes = await requestOtp({ contact });
    setOtpVerifyError(null);
    setOtpCode("");
    setOtpChallenge({ devCode: otpRes.devCode, verificationId: otpRes.verificationId, contact });
    setResendAtMs(Date.now() + OTP_RESEND_COOLDOWN_MS);
    setLiveMessage("Code sent");
  }

  async function handleResend() {
    const details = pendingDetailsRef.current;
    if (!details) return;
    setConfirming(true);
    try {
      await issueCode(details.contact);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "HOLD_EXPIRED") {
        setOtpChallenge(null);
        setServerExpired(true);
      } else if (err instanceof ApiRequestError) {
        setOtpVerifyError(err.message || errorPresentation[err.code].detail);
      } else {
        setOtpVerifyError("Could not reach the server. Check your connection.");
      }
    } finally {
      setConfirming(false);
    }
  }

  async function handleDetailsSubmit() {
    setConfirming(true);
    try {
      const current = attemptRef.current;
      if (!current) {
        setConfirmState({ fieldErrors: {}, panelError: "Something went wrong on our side." });
        return;
      }

      if (current.submitted) {
        await doConfirm(current.submitted, current);
        return;
      }

      const name = nameValue.trim();
      const contactChannel: OtpChannel = channel;
      const rawContact = (channel === "email" ? emailValue : phoneValue).trim();
      const contactParse = otpContactSchema.safeParse(
        contactChannel === "email" ? { channel: "email", email: rawContact } : { channel: "sms", phone: rawContact },
      );
      if (!contactParse.success) {
        const message =
          contactChannel === "email" ? "Enter a valid email address." : "Enter the 10 digits after +91.";
        setConfirmState({ fieldErrors: { contact: message }, panelError: null });
        return;
      }
      const contact = contactParse.data;

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
        await issueCode(contact);
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

  async function handleVerifySubmit() {
    const current = attemptRef.current;
    const details = pendingDetailsRef.current;
    if (!current || !otpChallenge || !details) return;
    const code = otpCode.trim();
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

  function handleChangeContact() {
    setOtpChallenge(null);
    setOtpVerifyError(null);
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

  const recap = (
    <div style={riseDelay(1)} className="anim-rise stub flex flex-col gap-1 p-6">
      <p className="font-display text-xl uppercase tracking-wide">{station.name}</p>
      <div className="stub-perf my-3" />
      <p className="text-base">
        {businessDateLabel(venue, new Date(nowMs), date)}, {startLabel} to {endLabel}
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
            className={`text-muted-foreground hover:text-foreground -my-2.5 self-start ${UNDERLINE_LINK}`}
          >
            Pick another time
          </button>
        </div>
      </PageShell>
    );
  }

  const disabled = confirming || otpVerifying || (attempt?.outcomeUnknown ?? false);
  const nameErrorId = "details-name-error";
  const contactErrorId = "details-contact-error";
  function clearFieldError(field: "name" | "contact") {
    setConfirmState((state) =>
      state.fieldErrors[field] ? { ...state, fieldErrors: { ...state.fieldErrors, [field]: undefined } } : state,
    );
  }
  const resendMs = Math.max(0, resendAtMs - nowMs);
  const otpContactLabel = otpChallenge
    ? otpChallenge.contact.channel === "email"
      ? otpChallenge.contact.email
      : `+91 ${otpChallenge.contact.phone}`
    : "";
  const holdCountdownLine = countdown ? (
    <p className={`text-center text-sm ${countdown.urgent ? "text-destructive" : "text-muted-foreground"}`}>
      {countdown.urgent ? "Hurry, this" : "This"} spot is yours for the next{" "}
      <span className="font-mono">{countdown.label}</span>
    </p>
  ) : null;
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
      {otpChallenge ? (
        <div style={riseDelay(2)} className="anim-rise flex flex-col gap-3" ref={scrollPanelIntoView}>
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <span>
              Code sent to <span className="font-medium">{otpContactLabel}</span>
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <button
              type="button"
              onClick={handleChangeContact}
              aria-label={otpChallenge.contact.channel === "sms" ? "Change number" : "Change email address"}
              className={`text-muted-foreground hover:text-foreground -my-2.5 ${UNDERLINE_LINK}`}
            >
              Change
            </button>
          </div>
          {otpChallenge.devCode ? (
            <Notice>
              Mock code, dev only: <span className="font-mono font-semibold">{otpChallenge.devCode}</span>
            </Notice>
          ) : null}
          {otpVerifyError ? <Notice tone="destructive">{otpVerifyError}</Notice> : null}
          <form action={() => void handleVerifySubmit()} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="details-otp-code" className="flex items-center gap-2 text-sm leading-none font-medium select-none">
                Code
              </label>
              <input
                id="details-otp-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="123456"
                required
                disabled={otpVerifying}
                autoFocus
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ""))}
                className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-12 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-center font-mono text-xl tracking-[0.3em] tabular-nums outline-none transition-colors focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={otpVerifying}
              className={`pressable btn-go h-12 rounded-(--radius) text-base font-semibold disabled:opacity-50 ${FOCUS_RING}`}
            >
              {otpVerifying ? "Verifying…" : "Verify and book"}
            </button>
          </form>
          {resendMs > 0 ? (
            <p className="text-muted-foreground text-sm">
              Send a new code in <span className="font-mono">{formatCountdown(Math.ceil(resendMs / 1000) * 1000)}</span>
            </p>
          ) : (
            <button
              type="button"
              disabled={confirming || otpVerifying}
              onClick={() => void handleResend()}
              className={`text-muted-foreground hover:text-foreground -my-2.5 self-start disabled:opacity-50 ${UNDERLINE_LINK}`}
            >
              Send a new code
            </button>
          )}
          {holdCountdownLine}
        </div>
      ) : (
        <form
          action={() => void handleDetailsSubmit()}
          style={riseDelay(2)}
          className="anim-rise flex flex-col gap-3"
        >
          <TextField
            id="details-name"
            label="Name"
            name="name"
            placeholder="Your name"
            maxLength={80}
            required
            disabled={disabled}
            value={nameValue}
            onChange={(event) => {
              setNameValue(event.target.value);
              clearFieldError("name");
            }}
            aria-invalid={confirmState.fieldErrors.name ? true : undefined}
            aria-describedby={confirmState.fieldErrors.name ? nameErrorId : undefined}
          />
          <FieldError id={nameErrorId} message={confirmState.fieldErrors.name} />
          <ChannelToggle
            value={channel}
            onValueChange={(next) => {
              setChannel(next);
              clearFieldError("contact");
            }}
            disabled={disabled}
          />
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
              value={emailValue}
              onChange={(event) => {
                setEmailValue(event.target.value);
                clearFieldError("contact");
              }}
              aria-invalid={confirmState.fieldErrors.contact ? true : undefined}
              aria-describedby={confirmState.fieldErrors.contact ? contactErrorId : undefined}
            />
          ) : (
            <PhoneField
              id="details-contact"
              label="Mobile number"
              value={phoneValue}
              onValueChange={(value) => {
                setPhoneValue(value);
                clearFieldError("contact");
              }}
              disabled={disabled}
              invalid={Boolean(confirmState.fieldErrors.contact)}
              describedBy={confirmState.fieldErrors.contact ? contactErrorId : undefined}
            />
          )}
          <FieldError id={contactErrorId} message={confirmState.fieldErrors.contact} />
          <button
            type="submit"
            disabled={disabled}
            className={`pressable btn-go mt-2 h-12 rounded-(--radius) text-base font-semibold disabled:opacity-50 ${FOCUS_RING}`}
          >
            {confirming ? "Booking…" : `Book for ₹${priceRupees}`}
          </button>
          {attempt?.outcomeUnknown ? (
            <div className="flex flex-col gap-2">
              <button
                type="submit"
                disabled={confirming}
                className={`text-muted-foreground hover:text-foreground -my-2.5 self-center disabled:opacity-50 ${UNDERLINE_LINK}`}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={handleStartOver}
                className={`text-destructive -my-2.5 self-center ${UNDERLINE_LINK}`}
              >
                Start over
              </button>
            </div>
          ) : (
            holdCountdownLine
          )}
        </form>
      )}
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
  const [prevSlots, setPrevSlots] = useState(search.slots);
  if (prevSlots !== search.slots) {
    setPrevSlots(search.slots);
    if (search.slots === undefined && pendingHours !== null) setPendingHours(null);
  }
  const [nowMs] = useState(() => Date.now());

  const venueQuery = useQuery(venueOptions());
  const venue = venueQuery.data;
  const date = venue ? (readSelectedDate() ?? currentBusinessDate(venue, new Date())) : undefined;
  const availabilityQuery = useQuery({
    ...availabilityOptions(date ?? "", undefined, search.slots !== undefined, ownHoldOf(readAttempt())),
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
  if (!availability) return <PageShell><LoadingScreen /></PageShell>;

  const cells = cellsByStation(availability.cells, stationId);

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
    return (
      <PageShell>
        <StepHeading step="Step 2 of 4" title="Pick a start time" onBack={onBackToStation} />
        <Notice>That start time is no longer available.</Notice>
      </PageShell>
    );
  }
  const startLabel = timeLabelOf(startCell);

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

  const options = lengthOptionsForStart(cells, search.start, station, availability.gridMinutes);

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
          className={`text-muted-foreground hover:text-foreground -my-2.5 self-start ${UNDERLINE_LINK}`}
        >
          Pick another time
        </button>
      </PageShell>
    );
  }

  async function handlePick(option: LengthOption) {
    setHoldError(null);
    setPendingHours(option.hours);
    const beatDone = new Promise<void>((resolve) => advanceAfterBeat(resolve));

    const previous = readAttempt();
    const isSameRequest =
      previous?.stationId === stationId && previous.startsAt === search.start && previous.slotCount === option.slotCount;
    if (previous && !isSameRequest) void releaseAttemptHold(previous, queryClient);

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
      await beatDone;
      void navigate({
        to: "/book/$stationId",
        params: { stationId },
        search: { start: search.start, slots: option.slotCount },
      });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "HOLD_UNAVAILABLE") {
        await beatDone;
        void navigate({
          to: "/book/$stationId",
          params: { stationId },
          search: { start: search.start, slots: option.slotCount },
        });
        return;
      }
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
          await beatDone;
          void navigate({
            to: "/book/$stationId",
            params: { stationId: sibling.station.id },
            search: { start: attempt.startsAt, slots: option.slotCount },
          });
          return;
        }
      }

      clearAttempt();
      setPendingHours(null);

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
