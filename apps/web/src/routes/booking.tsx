// `/booking/:id` -- confirmation code, recap, cancel. Screen built in step
// 9. Only the route's wiring lands in step 4.
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root.js";

export const bookingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/booking/$bookingId",
});
