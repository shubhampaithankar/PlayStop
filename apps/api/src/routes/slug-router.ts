import { Router } from "express";
import { availabilityRouter } from "#modules/availability/route.js";
import { bookingRouter } from "#modules/booking/route.js";
import { holdRouter } from "#modules/hold/route.js";
import { otpRouter } from "#modules/otp/route.js";
import { venueRouter } from "#modules/venue/route.js";

export const slugRouter = Router({ mergeParams: true });

slugRouter.use("/", venueRouter);
slugRouter.use("/availability", availabilityRouter);
slugRouter.use("/holds", holdRouter);
slugRouter.use("/bookings", bookingRouter);
slugRouter.use("/otp", otpRouter);