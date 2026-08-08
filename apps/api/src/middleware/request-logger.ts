import morgan from "morgan";
import type { Request, RequestHandler, Response } from "express";

// Custom token reads the id request-id.ts already stored on req.locals, so a
// log line can be joined to an error response body (same requestId in both).
// Generics needed: morgan's callback type defaults to plain
// http.IncomingMessage, which has no `locals`.
morgan.token<Request, Response>("request-id", (req) => req.locals?.requestId ?? "unknown");

// Render's log viewer is a plain text stream, not a JSON log processor, so a
// single readable line (Apache "combined" style plus the request id) beats a
// JSON blob here. Skips /health: Render's health check and the external
// keepalive ping (see app.ts) hit it every few minutes and would drown
// everything else out.
export const requestLogger: RequestHandler = morgan(
  ':remote-addr - [:request-id] ":method :url HTTP/:http-version" :status :res[content-length] :response-time ms',
  { skip: (req) => req.path === "/health" },
);
