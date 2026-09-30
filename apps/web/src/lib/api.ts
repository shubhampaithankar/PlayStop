// The single network choke point (milestone 3 spec, section 3). No component
// and no query function calls fetch directly; every request goes through
// `request()` below, which owns the base URL, the venue slug, the header
// set, and how a non-2xx body becomes a typed error.
import { z } from "zod";
import {
  apiErrorSchema,
  venueResponseSchema,
  availabilityResponseSchema,
  createHoldResponseSchema,
  bookingResponseSchema,
  lookupBookingsResponseSchema,
  otpRequestResponseSchema,
  otpVerifyResponseSchema,
  type ErrorCode,
  type AvailabilityQuery,
  type CreateHoldRequest,
  type ReleaseHoldRequest,
  type CreateBookingRequest,
  type OtpRequest,
  type OtpVerify,
  type LookupBookingsRequest,
} from "@playstop/engine";

/** The server answered with a structured error. `code` is the closed union from packages/engine. */
export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly requestId: string,
    readonly details: unknown,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super(message);
  }
}

/** The request never produced a server answer. `outcomeUnknown` drives the retry rules. */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
  constructor(
    message: string,
    /** True when the request may have reached the server and been processed. */
    readonly outcomeUnknown: boolean,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 90_000;

function envVar(key: "VITE_API_URL" | "VITE_VENUE_SLUG"): string | undefined {
  const fromVite = import.meta.env?.[key];
  if (fromVite) return fromVite;
  return typeof process !== "undefined" ? process?.env[key] : undefined;
}

function baseUrl(): string {
  const apiUrl = envVar("VITE_API_URL");
  const venueSlug = envVar("VITE_VENUE_SLUG");
  if (!apiUrl) throw new Error("VITE_API_URL is not set");
  if (!venueSlug) throw new Error("VITE_VENUE_SLUG is not set");
  return `${apiUrl}/v1/venues/${venueSlug}`;
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get("Retry-After");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : undefined;
}

type Method = "GET" | "POST";

interface RequestOptions<T> {
  readonly method: Method;
  /** Relative to /v1/venues/{slug}, e.g. "/availability". */
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  /** The response schema from @playstop/engine. */
  readonly schema: z.ZodType<T>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

async function request<T>(opts: RequestOptions<T>): Promise<T> {
  const url = new URL(`${baseUrl()}${opts.path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) url.searchParams.set(key, value);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey !== undefined) headers["Idempotency-Key"] = opts.idempotencyKey;

  const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers,
      signal,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (cause) {
    // Aborted by the caller's own signal (not our timeout) -> the caller
    // knows the outcome, it chose to cancel. Everything else -- our own
    // timeout firing, a real network failure -- means the request may or
    // may not have reached the server.
    const callerAborted = opts.signal?.aborted === true;
    const outcomeUnknown = opts.method === "POST" && !callerAborted;
    throw new NetworkError("Could not reach the server.", outcomeUnknown, cause);
  }

  if (res.status === 204) return undefined as T;

  if (res.ok) {
    const json: unknown = await res.json();
    return opts.schema.parse(json);
  }

  const retryAfterSeconds = parseRetryAfter(res);
  const json: unknown = await res.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(json);
  if (parsed.success) {
    const { code, message, requestId, details } = parsed.data.error;
    throw new ApiRequestError(code, res.status, message, requestId, details, retryAfterSeconds);
  }
  throw new ApiRequestError(
    "INTERNAL",
    res.status,
    "Something went wrong on our side.",
    res.headers.get("X-Request-Id") ?? "unknown",
    undefined,
    retryAfterSeconds,
  );
}

export const getVenue = () => request({ method: "GET", path: "", schema: venueResponseSchema });

export const getAvailability = (q: AvailabilityQuery) =>
  request({
    method: "GET",
    path: "/availability",
    query: {
      date: q.date,
      ...(q.stationId ? { stationId: q.stationId } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
    },
    schema: availabilityResponseSchema,
  });

export const createHold = (b: CreateHoldRequest) =>
  request({ method: "POST", path: "/holds", body: b, schema: createHoldResponseSchema });

export const releaseHold = (b: ReleaseHoldRequest) =>
  request({ method: "POST", path: "/holds/release", body: b, schema: z.undefined() });

/** Best-effort hold release on tab close or reload (milestone-3-spec.md
 *  section 5, "Tab close and reload"). Fire and forget: keepalive lets the
 *  request outlive the unloading page, and there is nothing to await -- the
 *  caller has already left. Not through request(): keepalive needs a raw
 *  fetch, and a pagehide handler must never await a response. */
export function releaseHoldBeacon(b: ReleaseHoldRequest): void {
  try {
    const url = new URL(`${baseUrl()}/holds/release`);
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
      keepalive: true,
    });
  } catch {
    // best effort; the TTL is the real backstop (booking-correctness.md)
  }
}

export const createBooking = (b: CreateBookingRequest, idempotencyKey: string) =>
  request({ method: "POST", path: "/bookings", body: b, idempotencyKey, schema: bookingResponseSchema });

export const requestOtp = (b: OtpRequest) =>
  request({ method: "POST", path: "/otp/request", body: b, schema: otpRequestResponseSchema });

export const verifyOtp = (b: OtpVerify) =>
  request({ method: "POST", path: "/otp/verify", body: b, schema: otpVerifyResponseSchema });

export const lookupBookings = (b: LookupBookingsRequest) =>
  request({ method: "POST", path: "/bookings/lookup", body: b, schema: lookupBookingsResponseSchema });

export const getBooking = (id: string, code: string) =>
  request({ method: "GET", path: `/bookings/${id}`, query: { code }, schema: bookingResponseSchema });

export const cancelBooking = (id: string, code: string) =>
  request({
    method: "POST",
    path: `/bookings/${id}/cancel`,
    body: { confirmationCode: code },
    schema: bookingResponseSchema,
  });

/** Maps a zod `.flatten()`-shaped `details` value onto the player form's two
 *  fields, per section 6's VALIDATION_FAILED row: "Map fieldErrors.player.name
 *  and friends onto the matching inputs; anything in formErrors becomes a
 *  panel-level message." Handles both a nested `fieldErrors.player.name` and
 *  a dotted `fieldErrors["player.name"]`, since flatten()'s exact shape for a
 *  nested object varies by how the schema failed. Used for the server's
 *  VALIDATION_FAILED `details` and for the client's own pre-send parse of
 *  `createBookingRequestSchema`, which produces the identical flatten() shape. */
export function playerFieldErrors(
  details: unknown,
): { name?: string | undefined; phone?: string | undefined; email?: string | undefined; panel: string | null } {
  if (typeof details !== "object" || details === null) return { panel: null };
  const flat = details as { fieldErrors?: Record<string, unknown>; formErrors?: string[] };
  const fieldErrors = flat.fieldErrors ?? {};
  const nested = fieldErrors.player as { name?: string[]; phone?: string[]; email?: string[] } | undefined;
  const name = nested?.name?.[0] ?? (fieldErrors["player.name"] as string[] | undefined)?.[0];
  const phone = nested?.phone?.[0] ?? (fieldErrors["player.phone"] as string[] | undefined)?.[0];
  const email = nested?.email?.[0] ?? (fieldErrors["player.email"] as string[] | undefined)?.[0];
  return { name, phone, email, panel: flat.formErrors?.[0] ?? null };
}

type Recovery =
  | "retry-same" // same request, same idempotency key, a button the user presses
  | "rehold" // the range may still be free: re-acquire a hold, then confirm
  | "refetch-and-pick" // the range is gone: refresh the grid, choose again
  | "fix-input" // the user must change a field
  | "terminal"; // nothing the user can do here

interface ErrorPresentation {
  readonly title: string;
  readonly detail: string; // may be replaced by the server's message where it is better
  readonly recovery: Recovery;
  readonly surface: "toast" | "panel" | "field" | "page";
  readonly reportToSentry: boolean;
}

// Record<ErrorCode, ...> over the closed Zod enum from packages/types: adding
// a code there fails this file to compile until it is handled here too.
export const errorPresentation: Record<ErrorCode, ErrorPresentation> = {
  SLOT_TAKEN: {
    title: "Just booked",
    detail: "Part of that time was just booked by someone else.",
    recovery: "refetch-and-pick",
    surface: "toast",
    reportToSentry: false,
  },
  SLOT_HELD: {
    title: "Just held",
    detail: "Someone else holds part of that time. Pick another start.",
    recovery: "refetch-and-pick",
    surface: "toast",
    reportToSentry: false,
  },
  HOLD_EXPIRED: {
    title: "Hold expired",
    detail: "Your hold ran out, but this time may still be free.",
    recovery: "rehold",
    surface: "panel",
    reportToSentry: false,
  },
  SLOT_UNAVAILABLE: {
    title: "Blocked for maintenance",
    detail: "That time is blocked for maintenance.",
    recovery: "refetch-and-pick",
    surface: "toast",
    reportToSentry: false,
  },
  SLOT_NOT_ON_GRID: {
    title: "Schedule refreshed",
    detail: "That time is no longer bookable. The schedule was refreshed.",
    recovery: "refetch-and-pick",
    surface: "toast",
    reportToSentry: true,
  },
  SLOT_OUT_OF_WINDOW: {
    title: "No longer bookable",
    detail: "That slot has passed, or runs past closing. Pick another.",
    recovery: "refetch-and-pick",
    surface: "toast",
    reportToSentry: false,
  },
  SLOT_TOO_SOON: {
    title: "Too soon",
    detail: "That slot is too close to now. Pick a later one.",
    recovery: "refetch-and-pick",
    surface: "toast",
    reportToSentry: false,
  },
  SLOT_COUNT_OUT_OF_RANGE: {
    title: "Out of range",
    detail: "This station takes a different number of hours.",
    recovery: "fix-input",
    surface: "field",
    reportToSentry: true,
  },
  PARTY_SIZE_EXCEEDS_CAPACITY: {
    title: "Too many players",
    detail: "This station has a lower capacity.",
    recovery: "fix-input",
    surface: "field",
    reportToSentry: false,
  },
  VALIDATION_FAILED: {
    title: "Check the form",
    detail: "Some fields need fixing.",
    recovery: "fix-input",
    surface: "field",
    reportToSentry: true,
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    title: "Something went wrong",
    detail: "Something went wrong on our side.",
    recovery: "terminal",
    surface: "panel",
    reportToSentry: true,
  },
  IDEMPOTENCY_KEY_REUSED: {
    title: "Something went wrong",
    detail: "Something went wrong on our side.",
    recovery: "retry-same",
    surface: "panel",
    reportToSentry: true,
  },
  REQUEST_IN_FLIGHT: {
    title: "Still working",
    detail: "Still working...",
    recovery: "retry-same",
    surface: "panel",
    reportToSentry: false,
  },
  RATE_LIMITED: {
    title: "Too many requests",
    detail: "Too many requests. Try again shortly.",
    recovery: "retry-same",
    surface: "toast",
    reportToSentry: false,
  },
  HOLD_UNAVAILABLE: {
    title: "Continuing without a hold",
    detail: "We could not place a hold right now, but you can still book.",
    recovery: "terminal",
    surface: "panel",
    reportToSentry: false,
  },
  BOOKING_TIMEOUT: {
    title: "Could not confirm in time",
    detail: "We could not confirm in time. Your booking may or may not have gone through.",
    recovery: "retry-same",
    surface: "panel",
    reportToSentry: false,
  },
  BOOKING_NOT_FOUND: {
    title: "Booking not found",
    detail: "We could not find that booking. Check the link, including the code at the end.",
    recovery: "terminal",
    surface: "page",
    reportToSentry: false,
  },
  BOOKING_NOT_CANCELLABLE: {
    title: "Already started",
    detail: "This session has already started. Call the venue.",
    recovery: "terminal",
    surface: "panel",
    reportToSentry: false,
  },
  STATION_NOT_FOUND: {
    title: "Station unavailable",
    detail: "That station is no longer available.",
    recovery: "refetch-and-pick",
    surface: "toast",
    reportToSentry: false,
  },
  VENUE_NOT_FOUND: {
    title: "Venue not available",
    detail: "This venue is not available.",
    recovery: "terminal",
    surface: "page",
    reportToSentry: true,
  },
  DATE_OUT_OF_RANGE: {
    title: "Not bookable",
    detail: "That date is not bookable.",
    recovery: "terminal",
    surface: "page",
    reportToSentry: true,
  },
  // The OTP panel (request -> code -> verify -> confirm) is the details
  // screen in book.station.tsx: OTP_REQUIRED is a defensive fallback (the
  // client always verifies before confirming), OTP_INVALID keeps the code
  // input open, and OTP_EXPIRED reuses the same expired panel as a lapsed
  // hold -- both mean "start this hold over."
  OTP_REQUIRED: {
    title: "Verify your phone",
    detail: "Verify the code we sent before we can confirm this booking.",
    recovery: "retry-same",
    surface: "panel",
    reportToSentry: true,
  },
  OTP_INVALID: {
    title: "Wrong code",
    detail: "That code does not match. Try again.",
    recovery: "fix-input",
    surface: "field",
    reportToSentry: false,
  },
  OTP_EXPIRED: {
    title: "Code expired",
    detail: "That code expired, but this time may still be free.",
    recovery: "rehold",
    surface: "panel",
    reportToSentry: false,
  },
  OTP_TOO_MANY: {
    title: "Too many tries",
    detail: "Too many tries. Wait a bit before trying again.",
    recovery: "retry-same",
    surface: "toast",
    reportToSentry: false,
  },
  NOT_FOUND: {
    title: "Not found",
    detail: "That page could not be found.",
    recovery: "terminal",
    surface: "page",
    reportToSentry: true,
  },
  INTERNAL: {
    title: "Something went wrong",
    detail: "Something went wrong on our side.",
    recovery: "retry-same",
    surface: "panel",
    reportToSentry: true,
  },
};
