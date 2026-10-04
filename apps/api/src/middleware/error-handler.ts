import type { NextFunction, Request, Response } from "express";
import { ERROR_CODES, type ApiError } from "@playstop/engine";
import { DomainError } from "#errors.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const requestId = req.locals?.requestId ?? "unknown";

  if (err instanceof DomainError) {
    if (err.headers) {
      for (const [name, value] of Object.entries(err.headers)) res.setHeader(name, value);
    }
    const body: ApiError = {
      error: { code: err.code, message: err.message, details: err.details, requestId },
    };
    res.status(err.status).json(body);
    return;
  }

  console.error(
    JSON.stringify({
      level: "error",
      event: "unhandled_error",
      requestId,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  const body: ApiError = {
    error: { code: ERROR_CODES.INTERNAL, message: "Something went wrong. Please try again.", requestId },
  };
  res.status(500).json(body);
}
