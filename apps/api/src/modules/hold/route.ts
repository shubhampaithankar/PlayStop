import { Router } from "express";
import { rateLimit } from "#middleware/rate-limit.js";
import { createHold, releaseHoldRoute } from "#modules/hold/controller.js";

export const holdRouter = Router({ mergeParams: true });

holdRouter.post("/holds", rateLimit, createHold);
holdRouter.post("/holds/release", releaseHoldRoute);
