// Router assembly and Sentry init (milestone-3-spec.md section 2 and
// section 14 step 4). Sentry.init lives here, after createRouter, because
// tanstackRouterBrowserTracingIntegration needs the router instance --
// unlike the API, where Sentry must be the first import, it cannot be
// initialised any earlier here.
//
// Relative .js-extension imports for the same reason as routes/root.tsx:
// apps/web/tests/router.test.ts imports this module under plain
// `node --test`, which has no Vite alias resolution.
import * as Sentry from "@sentry/react";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { ApiRequestError } from "./lib/api.js";
import { rootRoute } from "./routes/root.js";
import { indexRoute } from "./routes/index.js";
import { bookRoute } from "./routes/book.js";
import { bookStationRoute } from "./routes/book.station.js";
import { bookingRoute } from "./routes/booking.js";

const routeTree = rootRoute.addChildren([
  indexRoute,
  bookRoute.addChildren([bookStationRoute]),
  bookingRoute,
]);

// node --test has no window, so no browser History API to build the
// default history from. Falling back to an in-memory history lets
// router.test.ts import the real router and inspect routeTree without a
// browser; the browser always has window, so production is unaffected.
export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  ...(typeof window === "undefined" ? { history: createMemoryHistory() } : {}),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Sentry's browser SDK expects window/document and has nothing to
// instrument without one, so skip init entirely under node --test. The
// browser always has window, so this never affects dev or production.
if (typeof window !== "undefined") {
  Sentry.init({
    dsn: import.meta.env?.VITE_SENTRY_DSN, // undefined disables the SDK, same as the API
    integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
    tracesSampleRate: 0.1,
    beforeSend(event, hint) {
      if (import.meta.env?.DEV) return null;
      const error = hint.originalException;
      if (error instanceof ApiRequestError) {
        // Mirrors the API's Sentry filter (apps/api/src/libs/sentry/index.ts):
        // these codes are expected traffic, not bugs.
        if ([404, 409, 410, 422, 429].includes(error.status)) return null;
        event.tags = { ...event.tags, requestId: error.requestId };
      }
      return event;
    },
  });
}
