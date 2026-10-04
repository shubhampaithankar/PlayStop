import type { ObjectId } from "mongodb";
import { env } from "#env.js";
import { collections, type SlotClaimDoc } from "#libs/mongo/index.js";
import { redis, tryRedis } from "#libs/redis/index.js";
import { HOLD_KEY_PATTERN } from "#modules/hold/constants.js";
import type { HeldCell } from "#types/hold.js";

export function holdKey(venueId: ObjectId, stationId: ObjectId, cellStartMs: number): string {
  return `ps:${env.APP_ENV}:${venueId.toHexString()}:hold:${stationId.toHexString()}:${cellStartMs}`;
}

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

export async function releaseHold(
  venueId: ObjectId,
  stationId: ObjectId,
  cellStartsMs: readonly number[],
  holdId: string,
): Promise<void> {
  const keys = cellStartsMs.map((ms) => holdKey(venueId, stationId, ms));
  await tryRedis(() => redis.holdRelease(keys.length, ...keys, holdId), 0);
}

export async function mgetHolds(
  venueId: ObjectId,
  stationId: ObjectId,
  cellStartsMs: readonly number[],
): Promise<{ values: (string | null)[]; degraded: boolean }> {
  const keys = cellStartsMs.map((ms) => holdKey(venueId, stationId, ms));
  const { value, degraded } = await tryRedis(() => redis.mget(...keys), keys.map(() => null));
  return { values: value, degraded };
}

export function findConfirmedClaimInRange(
  venueId: ObjectId,
  stationId: ObjectId,
  cellStartsMs: readonly number[],
): Promise<SlotClaimDoc | null> {
  return collections.slotClaims().findOne({
    venueId,
    stationId,
    cellStart: { $in: cellStartsMs.map((ms) => new Date(ms)) },
    status: "confirmed",
  });
}
