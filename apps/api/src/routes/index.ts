import { Router } from "express";
import { rateLimit } from "#middleware/rate-limit.js";
import { resolveVenue } from "#middleware/venue.js";
import { venueRouter } from "#modules/venue/route.js";
import { availabilityRouter } from "#modules/availability/route.js";
import { holdRouter } from "#modules/hold/route.js";
import { cancelBooking, createBooking, getBooking } from "#routes/bookings.js";

// Every /v1 route is scoped to a venue, so resolution mounts once here
// rather than being repeated per module (spec section 6).
const router = Router();

router.use("/venues/:venueSlug", resolveVenue, venueRouter, availabilityRouter);

// Rate limiting must run after resolveVenue (it keys on req.venue) and
// before any of the routes below dispatch to a handler.
router.post(
  [
    "/venues/:venueSlug/holds",
    "/venues/:venueSlug/bookings",
    "/venues/:venueSlug/bookings/:bookingId/cancel",
  ],
  rateLimit,
);

router.use("/venues/:venueSlug", holdRouter);
router.post("/venues/:venueSlug/bookings", createBooking);
router.get("/venues/:venueSlug/bookings/:bookingId", getBooking);
router.post("/venues/:venueSlug/bookings/:bookingId/cancel", cancelBooking);

export default router;
