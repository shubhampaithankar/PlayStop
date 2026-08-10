// Milestone 3 spec section 14, step 4's "done when": the route tree exists
// and the four screens are wired under the root route. No browser -- this
// imports the real router.tsx (which falls back to an in-memory history
// under node --test, see that file) and inspects the plain object graph
// createRouter builds from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { router } from "../src/router.js";

test("the route tree has exactly the four screens from section 0, plus the root", () => {
  const ids = Object.keys(router.routesById).sort();
  assert.deepEqual(ids, ["__root__", "/", "/book", "/book/$stationId", "/booking/$bookingId"].sort());
});

test("each route's fullPath is correct, which is also proof of correct nesting", () => {
  // fullPath is built by walking the parent chain, so a correct value here
  // is proof /book/$stationId nests under /book rather than under root
  // directly -- a wrong parent would produce "/$stationId" instead.
  const routes = router.routesById;
  assert.equal(routes["/"]?.fullPath, "/");
  assert.equal(routes["/book"]?.fullPath, "/book");
  assert.equal(routes["/book/$stationId"]?.fullPath, "/book/$stationId");
  assert.equal(routes["/booking/$bookingId"]?.fullPath, "/booking/$bookingId");
});
