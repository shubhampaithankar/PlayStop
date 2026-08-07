import type { ObjectId } from "mongodb";
import { env } from "#env.js";
import { redis, tryRedis } from "#libs/redis/index.js";

// ps:{env}:{venueId}:hold:{stationId}:{cellStartEpochMs}. Every key on this
// namespace goes through this function; no route builds a key by string
// concatenation. This is the Redis-side equivalent of "every query filters
// on venueId".
export function holdKey(venueId: ObjectId, stationId: ObjectId, cellStartMs: number): string {
  return `ps:${env.APP_ENV}:${venueId.toHexString()}:hold:${stationId.toHexString()}:${cellStartMs}`;
}

export interface HeldCell {
  readonly stationId: string;
  readonly cellStartMs: number;
}

const HOLD_KEY_PATTERN = /^ps:[^:]+:[0-9a-f]{24}:hold:([0-9a-f]{24}):(\d+)$/;

// ponytail: SCAN over a small keyspace; switch to a per-venue-day SET index
// if concurrent holds exceed ~1k (spec section 4).
export async function scanVenueHolds(venueId: ObjectId): Promise<{ holds: HeldCell[]; degraded: boolean }> {
  const pattern = `ps:${env.APP_ENV}:${venueId.toHexString()}:hold:*`;
  const { value, degraded } = await tryRedis(async () => {
    const found: HeldCell[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
      cursor = next;
      for (const key of keys) {
        const match = HOLD_KEY_PATTERN.exec(key);
        if (match?.[1] && match[2]) {
          found.push({ stationId: match[1], cellStartMs: Number(match[2]) });
        }
      }
    } while (cursor !== "0");
    return found;
  }, []);
  return { holds: value, degraded };
}

/**
 * All-or-nothing acquire across every cell in the range (the Lua script in
 * redis.ts). degraded means Redis was unreachable (caller maps to 503
 * HOLD_UNAVAILABLE); acquired=false with degraded=false means the script
 * genuinely found a taken cell (caller maps to 409 SLOT_HELD).
 */
export async function acquireHold(
  venueId: ObjectId,
  stationId: ObjectId,
  cellStartsMs: readonly number[],
  holdId: string,
  ttlMs: number,
): Promise<{ acquired: boolean; degraded: boolean }> {
  const keys = cellStartsMs.map((ms) => holdKey(venueId, stationId, ms));
  const { value, degraded } = await tryRedis(() => redis.holdAcquire(keys.length, ...keys, holdId, ttlMs), 0);
  return { acquired: value === 1, degraded };
}

// Compare-and-delete per cell. Fire-and-forget at the confirm callsite: a
// failure here just leaves the TTL as the backstop. Explicit release
// returns 204 regardless of degraded/acquired: "not holding this" is true
// either way.
export async function releaseHold(
  venueId: ObjectId,
  stationId: ObjectId,
  cellStartsMs: readonly number[],
  holdId: string,
): Promise<void> {
  const keys = cellStartsMs.map((ms) => holdKey(venueId, stationId, ms));
  await tryRedis(() => redis.holdRelease(keys.length, ...keys, holdId), 0);
}

/**
 * MGET across every play-cell key. Returns the raw array (positions match
 * cellStartsMs) plus degraded; callers apply the decision table themselves,
 * since the correct action differs between routes.
 */
export async function mgetHolds(
  venueId: ObjectId,
  stationId: ObjectId,
  cellStartsMs: readonly number[],
): Promise<{ values: (string | null)[]; degraded: boolean }> {
  const keys = cellStartsMs.map((ms) => holdKey(venueId, stationId, ms));
  const { value, degraded } = await tryRedis(() => redis.mget(...keys), keys.map(() => null));
  return { values: value, degraded };
}
