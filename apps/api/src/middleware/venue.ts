import type { NextFunction, Request, Response } from "express";
import { collections, type VenueDoc } from "#libs/mongo/index.js";
import { DomainError } from "#errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      venue?: VenueDoc;
    }
  }
}

// Resolves the slug to a venue document once and attaches it. Every
// downstream handler reads venueId from req.venue, never from the request
// body or query: this is the single tenant-resolution point.
export function resolveVenue(req: Request, _res: Response, next: NextFunction): void {
  const venueSlug = req.params.venueSlug;
  if (typeof venueSlug !== "string") {
    next(new DomainError("VENUE_NOT_FOUND", 404, "No venue matches that slug."));
    return;
  }
  collections
    .venues()
    .findOne({ slug: venueSlug })
    .then((venue) => {
      if (!venue) {
        next(new DomainError("VENUE_NOT_FOUND", 404, "No venue matches that slug."));
        return;
      }
      req.venue = venue;
      next();
    })
    .catch(next);
}
