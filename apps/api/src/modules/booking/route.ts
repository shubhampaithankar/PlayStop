import { Router } from "express";
import { rateLimit } from "#middleware/rate-limit.js";
import { cancelBooking, createBooking, getBooking } from "#modules/booking/controller.js";

export const bookingRouter = Router({ mergeParams: true });

bookingRouter.post("/", rateLimit, createBooking);
bookingRouter.get("/:bookingId", getBooking);
bookingRouter.post("/:bookingId/cancel", rateLimit, cancelBooking);