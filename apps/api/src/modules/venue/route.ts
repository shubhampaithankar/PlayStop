import { Router } from "express";
import { getVenue } from "#modules/venue/controller.js";

export const venueRouter = Router({ mergeParams: true });

venueRouter.get("/", getVenue);
