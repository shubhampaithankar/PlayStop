import { Router } from "express";
import { createHold, releaseHoldRoute } from "#modules/hold/controller.js";

export const holdRouter = Router({ mergeParams: true });

holdRouter.post("/holds", createHold);
holdRouter.post("/holds/release", releaseHoldRoute);
