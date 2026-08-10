// `/book` -- the availability grid, plus an <Outlet/> for the hold panel
// child route. Screen built in steps 6-7. Only the route's wiring lands in
// step 4.
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root.js";

export const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/book",
});
