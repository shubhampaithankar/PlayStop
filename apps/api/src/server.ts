import cors from "cors";
import express from "express";
import type { HealthResponse } from "@playstop/types";
import { createIndexes, connectMongo, pingMongo } from "#db.js";
import { env } from "#env.js";
import { errorHandler } from "#middleware/errorHandler.js";
import { notFoundHandler } from "#middleware/notFound.js";
import { rateLimit } from "#middleware/rateLimit.js";
import { requestId } from "#middleware/requestId.js";
import { resolveVenue } from "#middleware/venue.js";
import { waitForRedisReady } from "#redis.js";

async function main(): Promise<void> {
  // Index creation runs before the HTTP listener starts. A running API
  // without uniq_slot_claim is a correctness hazard, so a failure here
  // exits the process rather than serving traffic against an unsafe schema.
  await connectMongo();
  await createIndexes();

  // Redis holds are advisory UX, never truth (section 4), so an unreachable
  // Redis at boot degrades rather than blocking startup.
  try {
    await waitForRedisReady();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "redis_not_ready_at_boot",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.listen(env.PORT, () => {
    console.log(`api listening on port ${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal error during boot:", err);
  process.exit(1);
});
