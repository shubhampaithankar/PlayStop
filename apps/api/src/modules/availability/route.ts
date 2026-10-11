import { Router } from "express";
import { getAvailability, getAvailabilitySummary } from "#modules/availability/controller.js";

export const availabilityRouter = Router({ mergeParams: true });

availabilityRouter.get("/", getAvailability);
availabilityRouter.get("/summary", getAvailabilitySummary);
