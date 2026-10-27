import { Router } from "express";
import { getStations } from "#modules/station/controller.js";

export const stationRouter = Router({ mergeParams: true });

stationRouter.get("/", getStations);
