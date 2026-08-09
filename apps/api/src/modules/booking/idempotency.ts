import { createHash } from "node:crypto";
import { MongoServerError, type ObjectId } from "mongodb";
import { ERROR_CODES } from "@playstop/engine";
import { collections } from "#libs/mongo/index.js";
import { DomainError } from "#errors.js";

// Sorts object keys recursively so two orderings of the same object hash
// identically. Otherwise a client that serializes in a different key order
// gets a spurious IDEMPOTENCY_KEY_REUSED.
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

// Hashed over the VALIDATED body (post-Zod-parse), not the raw request
// bytes: Zod strips unknown keys and applies defaults, so a retry differing
// only in whitespace or an ignored extra field is correctly the same
// request.
export function hashRequest(validatedBody: unknown): string {
  return createHash("sha256").update(canonicalJson(validatedBody)).digest("hex");
}

const IN_FLIGHT_STALE_MS = 60_000;
const RETENTION_MS = 86_400_000;

export type IdempotencyClaim =
  | { readonly outcome: "claimed"; readonly id: string }
  | { readonly outcome: "replay"; readonly statusCode: number; readonly response: unknown };

/**
 * The insertOne on _id IS the claim: atomic, no transaction, one write.
 * Resolves a lost claim per spec section 5's table. Throws DomainError
 * directly for IDEMPOTENCY_KEY_REUSED (422) and REQUEST_IN_FLIGHT (409),
 * since both are terminal outcomes the caller re-throws unchanged.
 */
export async function claimIdempotency(
  venueId: ObjectId,
  key: string,
  requestHash: string,
  now: Date,
): Promise<IdempotencyClaim> {
  const id = `${venueId.toHexString()}:${key}`;
  try {
    await collections.idempotency().insertOne({
      _id: id,
      venueId,
      key,
      requestHash,
      state: "in_flight",
      createdAt: now,
      expiresAt: new Date(now.getTime() + RETENTION_MS),
    });
    return { outcome: "claimed", id };
  } catch (err) {
    if (!(err instanceof MongoServerError && err.code === 11000)) throw err;
  }

  const existing = await collections.idempotency().findOne({ _id: id });
  if (!existing) {
    // ponytail: vanished between the failed insert and this read (a
    // concurrent non-deterministic-failure cleanup, or the 24h TTL sweep
    // landing mid-request). Safe to re-attempt the claim once; insertOne
    // is still the atomic source of truth either way.
    return claimIdempotency(venueId, key, requestHash, now);
  }

  if (existing.requestHash !== requestHash) {
    throw new DomainError(
      ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
      422,
      "This idempotency key was already used for a different request.",
    );
  }

  if (existing.state === "completed" || existing.state === "failed") {
    return { outcome: "replay", statusCode: existing.statusCode ?? 500, response: existing.response };
  }

  // in_flight: take over only if the original request looks abandoned.
  const takeover = await collections.idempotency().updateOne(
    { _id: id, state: "in_flight", createdAt: { $lt: new Date(now.getTime() - IN_FLIGHT_STALE_MS) } },
    { $set: { createdAt: now } },
  );
  if (takeover.modifiedCount === 1) {
    return { outcome: "claimed", id };
  }
  throw new DomainError(ERROR_CODES.REQUEST_IN_FLIGHT, 409, "This request is already being processed.", undefined, {
    "Retry-After": "1",
  });
}

// Deterministic domain failure: the record stays, replayable, because
// retrying would deterministically produce the same answer.
export async function finalizeFailure(id: string, statusCode: number, response: unknown): Promise<void> {
  await collections.idempotency().updateOne({ _id: id }, { $set: { state: "failed", statusCode, response } });
}

// Non-deterministic infrastructure failure: delete rather than record, so
// the client can retry the same key and actually get a booking.
export async function abandonClaim(id: string): Promise<void> {
  await collections.idempotency().deleteOne({ _id: id });
}
