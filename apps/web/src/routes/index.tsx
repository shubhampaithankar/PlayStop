// `/` -- venue landing, pick a date. Screen built in milestone-3-spec.md
// section 14 step 5 (venue query in the root loader, opening hours, station
// summary, the date picker). Only the route's wiring lands in step 4.
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root.js";

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
});
