import { Router } from "express";
import { cancelBooking, createBooking, getBooking } from "#modules/booking/controller.js";

export const bookingRouter = Router({ mergeParams: true });

bookingRouter.post("/bookings", createBooking);
bookingRouter.get("/bookings/:bookingId", getBooking);
bookingRouter.post("/bookings/:bookingId/cancel", cancelBooking);
