import type { NextFunction, Request, Response } from "express";
import { ERROR_CODES } from "@playstop/engine";
import { DomainError } from "#errors.js";

export const RATE_LIMIT_WINDOW_MS = 60_000;
const envMax = Number.parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? "", 10);
export const RATE_LIMIT_MAX_REQUESTS = Number.isFinite(envMax) && envMax > 0 ? envMax : 30;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

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
