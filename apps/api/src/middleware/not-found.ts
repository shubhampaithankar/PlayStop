import type { Request, Response } from "express";
import { ERROR_CODES, type ApiError } from "@playstop/engine";

export function notFoundHandler(req: Request, res: Response): void {
  const requestId = req.locals?.requestId ?? "unknown";
  const body: ApiError = {
    error: { code: ERROR_CODES.NOT_FOUND, message: "No route matches this request.", requestId },
  };
  res.status(404).json(body);
}
