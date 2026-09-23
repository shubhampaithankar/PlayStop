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

// One round trip, atomic: a concurrent double-verify must not both read
// "not yet attempted" (spec section 3). ARGV[1] is codeHash, computed by
// the caller via node:crypto -- Lua never sees the raw code. Attempt cap
// (5) is a fixed business rule, not a runtime value, so it is inlined
// rather than threaded through ARGV.
const OTP_VERIFY_LUA = `
local key = KEYS[1]
local codeHash = ARGV[1]
if redis.call("EXISTS", key) == 0 then
  return "EXPIRED"
end
local attempts = tonumber(redis.call("HGET", key, "attempts")) or 0
if attempts >= 5 then
  return "TOOMANY"
end
redis.call("HINCRBY", key, "attempts", 1)
if redis.call("HGET", key, "codeHash") == codeHash then
  redis.call("HSET", key, "verified", 1)
  return "OK"
end
return "INVALID"
`;

// One round trip, atomic: INCR then PEXPIRE-only-on-first-increment used to
// be two calls, so a crash (or a Redis-down tryRedis catch) between them
// left a request-cap key with no TTL, never expiring. Same shape as the
// two Lua scripts above.
const OTP_REQUEST_INCR_LUA = `
local key = KEYS[1]
local ttlMs = ARGV[1]
local count = redis.call("INCR", key)
if count == 1 then
  redis.call("PEXPIRE", key, ttlMs)
end
return count
`;

// One round trip, atomic: HSET then PEXPIRE used to be two calls, so a
// crash between them left an OTP challenge hash with no TTL, never
// expiring (and never reusable by a fresh request, since HSET only
// overwrites fields, not the hash's TTL).
const OTP_CHALLENGE_WRITE_LUA = `
local key = KEYS[1]
redis.call("HSET", key, "codeHash", ARGV[1], "channel", ARGV[2], "contact", ARGV[3], "attempts", "0", "verified", "0", "requests", ARGV[4])
redis.call("PEXPIRE", key, ARGV[5])
return 1
`;

declare module "ioredis" {
  // Context must match RedisCommander's own type parameter name for
  // declaration merging, even though these signatures don't use it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface RedisCommander<Context> {
    holdAcquire(...args: (string | number)[]): Promise<number>;
    holdRelease(...args: (string | number)[]): Promise<number>;
    otpVerify(...args: (string | number)[]): Promise<"OK" | "INVALID" | "EXPIRED" | "TOOMANY">;
    otpRequestIncr(...args: (string | number)[]): Promise<number>;
    otpChallengeWrite(...args: (string | number)[]): Promise<number>;
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
redis.defineCommand("otpVerify", { lua: OTP_VERIFY_LUA });
redis.defineCommand("otpRequestIncr", { lua: OTP_REQUEST_INCR_LUA });
redis.defineCommand("otpChallengeWrite", { lua: OTP_CHALLENGE_WRITE_LUA });

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
