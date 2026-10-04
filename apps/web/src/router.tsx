import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { ApiRequestError } from "./lib/api.js";
import { rootRoute } from "./routes/root.js";
import { indexRoute } from "./routes/index.js";
import { bookRoute } from "./routes/book.js";
import { bookStationRoute } from "./routes/book.station.js";
import { bookingRoute } from "./routes/booking.js";
import { bookingsRoute } from "./routes/bookings.js";
import { bookingsFindRoute } from "./routes/bookings.find.js";
import { LoadingScreen } from "./components/screen-ui.js";

const routeTree = rootRoute.addChildren([
  indexRoute,
  bookRoute.addChildren([bookStationRoute]),
  bookingRoute,
  bookingsRoute,
  bookingsFindRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPendingComponent: LoadingScreen,
  defaultPendingMs: 200,
  defaultPendingMinMs: 500,
  ...(typeof window === "undefined" ? { history: createMemoryHistory() } : {}),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

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
          if ([404, 409, 410, 422, 429].includes(error.status)) return null;
          event.tags = { ...event.tags, requestId: error.requestId };
        }
        return event;
      },
    });
  });
}