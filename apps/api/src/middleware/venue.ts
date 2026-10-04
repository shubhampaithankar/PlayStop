import type { NextFunction, Request, Response } from "express";
import { collections, type VenueDoc } from "#libs/mongo/index.js";
import { ERROR_CODES } from "@playstop/engine";
import { DomainError } from "#errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      venue?: VenueDoc;
    }
  }
}

export function requireVenue(req: Request): VenueDoc {
  if (!req.venue) throw new DomainError(ERROR_CODES.VENUE_NOT_FOUND, 404, "No venue matches that slug.");
  return req.venue;
}

export function resolveVenue(req: Request, _res: Response, next: NextFunction): void {
  const venueSlug = req.params.venueSlug;
  if (typeof venueSlug !== "string") {
    next(new DomainError(ERROR_CODES.VENUE_NOT_FOUND, 404, "No venue matches that slug."));
    return;
  }
  collections
    .venues()
    .findOne({ slug: venueSlug })
    .then((venue) => {
      if (!venue) {
        next(new DomainError(ERROR_CODES.VENUE_NOT_FOUND, 404, "No venue matches that slug."));
        return;
      }
      req.venue = venue;
      next();
    })
    .catch(next);
}
