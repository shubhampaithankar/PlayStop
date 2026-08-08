import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { env } from "#env.js";

// Import side effect: no SENTRY_DSN (local dev, CI) makes this a no-op, per
// the Sentry Node docs -- Sentry.init with no dsn disables the SDK, no
// network calls, no crash.
Sentry.init({
  dsn: env.SENTRY_DSN,
  tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  environment: env.APP_ENV,
});

// Registered after the routes and notFoundHandler, before errorHandler
// (app.ts): Sentry's handler only reports, it never writes a response, so
// errorHandler still runs and builds the ApiError body with requestId same
// as before this file existed.
export function attachSentryErrorHandler(app: Express): void {
  Sentry.setupExpressErrorHandler(app, {
    // Per spec section 4, 409 SLOT_TAKEN (and 404/422/429) are expected
    // outcomes of normal traffic, not errors -- only 5xx and errors with no
    // status code (unhandled bugs) should become a Sentry issue.
    shouldHandleError(error) {
      const status = (error as { status?: number })?.status;
      return typeof status !== "number" || status >= 500;
    },
  });
}
