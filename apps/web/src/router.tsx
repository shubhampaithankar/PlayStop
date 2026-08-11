// Router assembly and Sentry init (milestone-3-spec.md section 2 and
// section 14 step 4). Sentry.init lives here, after createRouter, because
// tanstackRouterBrowserTracingIntegration needs the router instance --
// unlike the API, where Sentry must be the first import, it cannot be
// initialised any earlier here.
//
// Relative .js-extension imports for the same reason as routes/root.tsx:
// apps/web/tests/router.test.ts imports this module under plain
// `node --test`, which has no Vite alias resolution.
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

// Sentry is roughly 48 kB gzipped, close to a third of the entry-chunk budget
// in milestone-3-spec.md section 11, and that budget does not account for it.
// Loading it after mount keeps it out of the initial chunk and leaves the
// headroom for the booking UI. The trade is deliberate and narrow: an error
// thrown during the very first render is not captured.
//
// Skipped entirely without a DSN, so dev, CI and node --test never fetch the
// chunk at all. The browser always has window, so this only skips under tests.
if (typeof window !== "undefined" && import.meta.env?.VITE_SENTRY_DSN) {
  void import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn: import.meta.env?.VITE_SENTRY_DSN,
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
  });
}