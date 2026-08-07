import type { Request, Response } from "express";
import type { ApiError } from "@playstop/types";

// Fires only when nothing above matched at all (an unknown route, not a
// known-but-absent resource like an unknown venue slug, which raises its
// own DomainError through the normal error handler).
export function notFoundHandler(req: Request, res: Response): void {
  const requestId = req.locals?.requestId ?? "unknown";
  const body: ApiError = {
    error: { code: "NOT_FOUND", message: "No route matches this request.", requestId },
  };
  res.status(404).json(body);
}
