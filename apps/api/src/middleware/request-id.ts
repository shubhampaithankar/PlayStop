import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      locals: { requestId: string };
    }
  }
}

// crypto.randomUUID() onto req.locals.requestId, echoed in the
// X-Request-Id response header and inside every error body.
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  req.locals = { requestId: id };
  res.setHeader("X-Request-Id", id);
  next();
}
