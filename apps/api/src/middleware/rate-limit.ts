import type { NextFunction, Request, Response } from "express";
import { ERROR_CODES } from "@playstop/engine";
import { DomainError } from "#errors.js";

// ponytail: in-memory rate limit; per-instance only, so it does not hold
// across a multi-instance deploy. Move the counter to Redis (INCR +
// EXPIRE) when the API scales past one instance.
export const RATE_LIMIT_WINDOW_MS = 60_000;
// Overridable so the concurrency test suite (50+ requests to one venue in
// one window) can raise the ceiling without weakening the real limit.
// Unset in production and in the normal test run, so both still enforce 30.
const envMax = Number.parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? "", 10);
export const RATE_LIMIT_MAX_REQUESTS = Number.isFinite(envMax) && envMax > 0 ? envMax : 30;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Periodic sweep so abandoned keys (one-off IPs, stale venues) do not leak
// forever. unref() so it never keeps the process alive on its own.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// Pure fixed-window check, separated from Express so it is testable without
// faking req/res. `store` defaults to the shared module-level Map; tests
// pass their own.
export function checkRateLimit(
  key: string,
  now: number,
  store: Map<string, Bucket> = buckets,
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const bucket = store.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true };
}

// Mounted on POST /holds, POST /bookings, and POST /bookings/:id/cancel.
// Keyed by `${venueId}:${req.ip}`. Anonymous unauthenticated writes with
// zero throttling would let one script exhaust every station in a venue.
export function rateLimit(req: Request, _res: Response, next: NextFunction): void {
  if (req.method !== "POST") {
    next();
    return;
  }
  const venueId = req.venue ? req.venue._id.toHexString() : "unknown";
  const key = `${venueId}:${req.ip}`;
  const result = checkRateLimit(key, Date.now());
  if (!result.allowed) {
    next(
      new DomainError(
        ERROR_CODES.RATE_LIMITED,
        429,
        "Too many requests. Slow down and try again.",
        undefined,
        {
          "Retry-After": String(result.retryAfterSeconds),
        },
      ),
    );
    return;
  }
  next();
}
