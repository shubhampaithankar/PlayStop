import { Router } from "express";
import { resolveVenue } from "#middleware/venue.js";
import { slugRouter } from "#routes/slug-router.js";

const router = Router();

router.use("/venues/:venueSlug", resolveVenue, slugRouter);

export default router;