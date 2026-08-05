import cors from "cors";
import express from "express";
import type { HealthResponse } from "@playstop/shared";
import { env } from "./env.js";

const app = express();

app.use(cors({ origin: env.WEB_ORIGIN }));

// ponytail: Render free tier spins down after 15 min idle. Mitigation is an
// external 5-minute ping to this route (UptimeRobot or a Cloudflare Worker
// cron). Upgrade path: paid Render instance or Fly.io always-on. See README
// deploy section.
app.get("/health", (_req, res) => {
  const body: HealthResponse = { status: "ok", uptime: process.uptime() };
  res.json(body);
});

app.listen(env.PORT, () => {
  console.log(`api listening on port ${env.PORT}`);
});
