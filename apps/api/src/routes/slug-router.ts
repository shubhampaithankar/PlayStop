import { Router } from "express";
import { availabilityRouter } from "#modules/availability/route.js";
import { bookingRouter } from "#modules/booking/route.js";
import { holdRouter } from "#modules/hold/route.js";
import { venueRouter } from "#modules/venue/route.js";

// Everything a venue owns, mounted under /venues/:venueSlug by index.ts.
// mergeParams lets these module routers still read req.params.venueSlug
// after being mounted under a parameterised path.
export const slugRouter = Router({ mergeParams: true });

slugRouter.use("/", venueRouter);
slugRouter.use("/availability", availabilityRouter);
slugRouter.use("/holds", holdRouter);
slugRouter.use("/bookings", bookingRouter);