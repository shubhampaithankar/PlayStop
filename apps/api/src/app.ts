import cors from "cors";
import express, { type Express } from "express";
import type { HealthResponse } from "@playstop/engine";
import { pingMongo } from "#libs/mongo/index.js";
import { env } from "#env.js";
import { errorHandler } from "#middleware/error-handler.js";
import { notFoundHandler } from "#middleware/not-found.js";
import { requestId } from "#middleware/request-id.js";
import { requestLogger } from "#middleware/request-logger.js";
import v1Routes from "#routes/index.js";
import { attachSentryErrorHandler } from "#libs/sentry/index.js";

// Builds the app without booting Mongo/Redis or binding a port, so
// integration tests can call this directly and app.listen(0) on an
// ephemeral port (spec section 9).
export function buildApp(): Express {
  const app = express();

  // Trust exactly one proxy hop (Render's edge proxy). Express then reads
  // req.ip from the entry the proxy appended to X-Forwarded-For, not from
  // whatever a client tries to prepend, so rate-limit keys land on the
  // real client instead of the proxy's shared address.
  app.set("trust proxy", 1);

  // Cross-cutting middleware, in order (spec section 6).
  app.use(express.json({ limit: "16kb" }));
  // exposedHeaders is required for the browser to read these at all. Without
// it the server still sends them and cross-origin JS still cannot see them,
// which silently breaks request correlation and Retry-After handling in the
// web app.
app.use(
  cors({
    origin: env.WEB_ORIGIN,
    exposedHeaders: ["X-Request-Id", "Retry-After", "Idempotent-Replay"],
  }),
);
  app.use(requestId);
  app.use(requestLogger);

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
        const body: HealthResponse = { status: "degraded", uptime: process.uptime() };
        res.status(503).json(body);
      });
  });

  app.use("/v1", v1Routes);

  app.use(notFoundHandler);
  attachSentryErrorHandler(app);
  app.use(errorHandler);

  return app;
}
