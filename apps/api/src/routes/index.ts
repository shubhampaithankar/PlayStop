import { Router } from "express";
import { resolveVenue } from "#middleware/venue.js";
import { availabilityRouter } from "#modules/availability/route.js";
import { bookingRouter } from "#modules/booking/route.js";
import { holdRouter } from "#modules/hold/route.js";
import { venueRouter } from "#modules/venue/route.js";

// Everything under /v1 is scoped to one venue, so resolveVenue mounts once
// here instead of being repeated in every module. mergeParams lets the module
// routers still read req.params.venueSlug after being mounted under it.
const venueScoped = Router({ mergeParams: true });

venueScoped.use("/", venueRouter);
venueScoped.use("/availability", availabilityRouter);
venueScoped.use("/holds", holdRouter);
venueScoped.use("/bookings", bookingRouter);

const router = Router();

router.use("/venues/:venueSlug", resolveVenue, venueScoped);

export default router;