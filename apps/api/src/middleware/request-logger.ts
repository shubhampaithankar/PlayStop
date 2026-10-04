import morgan from "morgan";
import type { Request, RequestHandler, Response } from "express";

morgan.token<Request, Response>("request-id", (req) => req.locals?.requestId ?? "unknown");

export const requestLogger: RequestHandler = morgan(
  ':remote-addr - [:request-id] ":method :url HTTP/:http-version" :status :res[content-length] :response-time ms',
  { skip: (req) => req.path === "/health" },
);
