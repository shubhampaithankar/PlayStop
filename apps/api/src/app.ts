import cors from "cors";
import express, { type Express } from "express";
import type { HealthResponse } from "@playstop/types";
import { pingMongo } from "#libs/mongo/index.js";
import { env } from "#env.js";
import { errorHandler } from "#middleware/error-handler.js";
import { notFoundHandler } from "#middleware/not-found.js";
import { rateLimit } from "#middleware/rate-limit.js";
import { requestId } from "#middleware/request-id.js";
import { resolveVenue } from "#middleware/venue.js";
import { createHold, releaseHoldRoute } from "#routes/holds.js";
import { cancelBooking, createBooking, getBooking } from "#routes/bookings.js";
import { getAvailability, getVenue } from "#routes/venue.js";

// Builds the app without booting Mongo/Redis or binding a port, so
// integration tests can call this directly and app.listen(0) on an
// ephemeral port (spec section 9).
export function buildApp(): Express {
  const app = express();

  // Cross-cutting middleware, in order (spec section 6).
  app.use(express.json({ limit: "16kb" }));
  app.use(cors({ origin: env.WEB_ORIGIN }));
  app.use(requestId);

  // ponytail: Render free tier spins down after 15 min idle. Mitigation is an
  // external 5-minute ping to this route (UptimeRobot or a Cloudflare Worker
  // cron). Upgrade path: paid Render instance or Fly.io always-on. See README
  // deploy section.
  app.get("/health", (_req, res) => {
    pingMongo()
      .then(() => {
        const body: HealthResponse = { status: "ok", uptime: process.uptime() };
        res.json(body);
      })
      .catch(() => {
        res.status(503).json({ status: "degraded", uptime: process.uptime() });
      });
  });

  app.use("/v1/venues/:venueSlug", resolveVenue);
  app.post(
    [
      "/v1/venues/:venueSlug/holds",
      "/v1/venues/:venueSlug/bookings",
      "/v1/venues/:venueSlug/bookings/:bookingId/cancel",
    ],
    rateLimit,
  );

  app.get("/v1/venues/:venueSlug", getVenue);
  app.get("/v1/venues/:venueSlug/availability", getAvailability);
  app.post("/v1/venues/:venueSlug/holds", createHold);
  app.post("/v1/venues/:venueSlug/holds/release", releaseHoldRoute);
  app.post("/v1/venues/:venueSlug/bookings", createBooking);
  app.get("/v1/venues/:venueSlug/bookings/:bookingId", getBooking);
  app.post("/v1/venues/:venueSlug/bookings/:bookingId/cancel", cancelBooking);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
