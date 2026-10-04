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

export function buildApp(): Express {
  const app = express();

  app.set("trust proxy", 1);

  app.use(express.json({ limit: "16kb" }));
app.use(
  cors({
    origin: env.WEB_ORIGIN,
    exposedHeaders: ["X-Request-Id", "Retry-After", "Idempotent-Replay"],
  }),
);
  app.use(requestId);
  app.use(requestLogger);

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
