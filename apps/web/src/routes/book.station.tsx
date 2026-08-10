// `/book/:stationId` -- child of book.tsx: the hold panel (Drawer/Dialog),
// countdown, player form, confirm. Screen built in step 8. Only the route's
// wiring lands in step 4.
import { createRoute } from "@tanstack/react-router";
import { bookRoute } from "./book.js";

export const bookStationRoute = createRoute({
  getParentRoute: () => bookRoute,
  path: "$stationId",
});
