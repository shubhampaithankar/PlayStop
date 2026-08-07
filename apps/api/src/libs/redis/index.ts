import { Redis } from "ioredis";
import { env } from "#env.js";

// Multi-cell hold acquire/release, per spec section 4. Registered without a
// fixed numberOfKeys, so callers pass the key count as the first argument
// (redis.holdAcquire(numKeys, key1, ..., keyN, holdId, ttlMs)); the key
// count varies with slotCount, so a fixed count would be wrong for every
// booking that is not exactly that length.
const HOLD_ACQUIRE_LUA = `
for i = 1, #KEYS do
  if redis.call("EXISTS", KEYS[i]) == 1 then return 0 end
end
for i = 1, #KEYS do
  redis.call("SET", KEYS[i], ARGV[1], "PX", ARGV[2])
end
return 1
`;

const HOLD_RELEASE_LUA = `
local deleted = 0
for i = 1, #KEYS do
  if redis.call("GET", KEYS[i]) == ARGV[1] then
    deleted = deleted + redis.call("DEL", KEYS[i])
  end
end
return deleted
`;

declare module "ioredis" {
  // Context must match RedisCommander's own type parameter name for
  // declaration merging, even though these signatures don't use it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface RedisCommander<Context> {
    holdAcquire(...args: (string | number)[]): Promise<number>;
    holdRelease(...args: (string | number)[]): Promise<number>;
  }
}

export const redis = new Redis(env.REDIS_URL, {
  commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS,
  connectTimeout: 3000,
  maxRetriesPerRequest: 1, // fail fast into degraded mode, do not queue
  enableOfflineQueue: false, // CRITICAL: without this, commands hang until reconnect
  enableReadyCheck: true,
  retryStrategy: (times: number) => Math.min(times * 200, 5000),
});

redis.defineCommand("holdAcquire", { lua: HOLD_ACQUIRE_LUA });
redis.defineCommand("holdRelease", { lua: HOLD_RELEASE_LUA });

// ioredis catches its own unhandled error events and logs them rather than
// letting Node throw, verified directly against a refused connection. But
// those logs are raw stack traces that bypass structured logging. A
// persistent listener keeps connection failures in the same JSON shape as
// tryRedis's redis_degraded events, so an outage is greppable instead of
// noise. waitForRedisReady attaches its own once() listener independently;
// having both is fine.
redis.on("error", (err: Error) => {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "redis_connection_error",
      error: err.message,
    }),
  );
});

// Upstash verified: ioredis rejects commands issued before the socket is
// ready with "Stream isn't writeable" when enableOfflineQueue is false. The
// constructor returning does NOT mean the client is usable; boot must await
// this before treating Redis as available.
export async function waitForRedisReady(timeoutMs = 5000): Promise<void> {
  if (redis.status === "ready") return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis did not become ready within ${timeoutMs}ms (status: ${redis.status})`));
    }, timeoutMs);
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    function cleanup(): void {
      clearTimeout(timer);
      redis.off("ready", onReady);
      redis.off("error", onError);
    }
    redis.once("ready", onReady);
    redis.once("error", onError);
  });
}

// Every Redis call goes through this. Catches everything, logs
// redis_degraded, and returns the fallback. Redis exceptions never reach
// the HTTP error handler: a cache outage degrades UX, never correctness.
export async function tryRedis<T>(
  op: () => Promise<T>,
  fallback: T,
  requestId?: string,
): Promise<{ value: T; degraded: boolean }> {
  try {
    const value = await op();
    return { value, degraded: false };
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "redis_degraded",
        requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { value: fallback, degraded: true };
  }
}
