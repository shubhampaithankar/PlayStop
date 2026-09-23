// `/` -- DESIGN.md: "/` redirects into `/book`; there is no separate
// landing screen to design." The app is tonight-only, no date picker.
import { createRoute, redirect } from "@tanstack/react-router";
import { rootRoute } from "./root.js";

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/book" });
  },
});
