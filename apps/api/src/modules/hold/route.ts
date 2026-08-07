import { Router } from "express";
import { rateLimit } from "#middleware/rate-limit.js";
import { createHold, releaseHoldRoute } from "#modules/hold/controller.js";

export const holdRouter = Router({ mergeParams: true });

holdRouter.post("/", rateLimit, createHold);
// Release stays unlimited: it frees a resource, so throttling it works against us.
holdRouter.post("/release", releaseHoldRoute);