import { Router } from "express";
import { rateLimit } from "#middleware/rate-limit.js";
import { cancelBooking, createBooking, getBooking } from "#modules/booking/controller.js";

export const bookingRouter = Router({ mergeParams: true });

bookingRouter.post("/bookings", rateLimit, createBooking);
bookingRouter.get("/bookings/:bookingId", getBooking);
bookingRouter.post("/bookings/:bookingId/cancel", rateLimit, cancelBooking);
