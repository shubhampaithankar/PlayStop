import type { ErrorCode } from "@playstop/types";

// One class, no subclass hierarchy, no factory. Routes throw it; Express 5
// forwards it to the error handler, which serializes it. `headers` exists
// so REQUEST_IN_FLIGHT, RATE_LIMITED, and BOOKING_TIMEOUT can attach
// Retry-After without a special case in the handler.
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
