import { Router } from "express";
import { getAvailability } from "#modules/availability/controller.js";

export const availabilityRouter = Router({ mergeParams: true });

availabilityRouter.get("/availability", getAvailability);
