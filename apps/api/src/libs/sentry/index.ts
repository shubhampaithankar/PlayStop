import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { env } from "#env.js";

Sentry.init({
  dsn: env.SENTRY_DSN,
  tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  environment: env.APP_ENV,
});

export function attachSentryErrorHandler(app: Express): void {
  Sentry.setupExpressErrorHandler(app, {
    shouldHandleError(error) {
      const status = (error as { status?: number })?.status;
      return typeof status !== "number" || status >= 500;
    },
  });
}
