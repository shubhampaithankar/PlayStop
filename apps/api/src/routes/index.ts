import { Router } from "express";
import { resolveVenue } from "#middleware/venue.js";
import { venueRouter } from "#modules/venue/route.js";
import { availabilityRouter } from "#modules/availability/route.js";
import { holdRouter } from "#modules/hold/route.js";
import { bookingRouter } from "#modules/booking/route.js";

// Every /v1 route is scoped to a venue, so resolution mounts once here
// rather than being repeated per module (spec section 6).
const router = Router();

router.use("/venues/:venueSlug", resolveVenue, venueRouter, availabilityRouter, holdRouter, bookingRouter);

export default router;
