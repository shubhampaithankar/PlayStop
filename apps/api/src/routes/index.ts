import { Router } from "express";
import { resolveVenue } from "#middleware/venue.js";
import { slugRouter } from "#routes/slug-router.js";

const router = Router();

// resolveVenue runs once here, so no module has to restate it. Routes that
// are not venue-scoped (auth, accounts) mount as siblings of this line.
router.use("/venues/:venueSlug", resolveVenue, slugRouter);

export default router;