import { createHash, randomInt, randomUUID } from "node:crypto";
import type { ObjectId } from "mongodb";
import type { OtpChannel } from "@playstop/engine";
import { env } from "#env.js";
import { redis, tryRedis } from "#libs/redis/index.js";

// Request cap: 3 requests per contact within the TTL window (spec section
// 3) -- decoupled from any hold now, so the cap key is namespaced by
// channel+contact instead of a holdId. Verify's own attempt cap (5) is
// inlined in the otpVerify Lua script (libs/redis/index.ts), next to the
// attempts field it enforces against.
export const OTP_REQUEST_CAP = 3;
export const OTP_TTL_MS = 600_000; // fixed 10 minutes, no longer tied to a hold's TTL

// ps:{env}:{venueId}:otp:{verificationId}. Decoupled from holdId (spec
// section 1): the server mints verificationId itself, so a challenge has an
// identity independent of any hold or booking attempt.
export function otpKey(venueId: ObjectId, verificationId: string): string {
  return `ps:${env.APP_ENV}:${venueId.toHexString()}:otp:${verificationId}`;
}

// ps:{env}:{venueId}:otpcap:{channel}:{contact}, a separate namespace from
// the challenge itself: the cap must survive across many verificationIds
// for the same contact, while each challenge hash is one-shot.
function otpCapKey(venueId: ObjectId, channel: OtpChannel, contact: string): string {
  return `ps:${env.APP_ENV}:${venueId.toHexString()}:otpcap:${channel}:${contact}`;
}

export function mintVerificationId(): string {
  return randomUUID();
}

export function hashOtpCode(verificationId: string, code: string): string {
  return createHash("sha256").update(`${verificationId}:${code}`).digest("hex");
}

export function generateMockCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

// Atomic INCR + conditional PEXPIRE in one round trip via the otpRequestIncr
// Lua command (libs/redis/index.ts): two concurrent requests reading the
// same "requests so far" value would both compute the same next count and
// both pass the cap check, letting the cap be bypassed under concurrency.
// A separate INCR-then-PEXPIRE pair also left a crash-between-calls window
// where the cap key never expired. The TTL is only set on the first
// increment (count === 1); two concurrent first requests both setting it is
// harmless, since both set the same value. The returned count already
// reflects this request.
export async function incrementOtpRequestCount(
  venueId: ObjectId,
  channel: OtpChannel,
  contact: string,
): Promise<{ count: number; degraded: boolean }> {
  const key = otpCapKey(venueId, channel, contact);
  const { value, degraded } = await tryRedis(() => redis.otpRequestIncr(1, key, OTP_TTL_MS), 0);
  return { count: value, degraded };
}

export async function otpCapPttlMs(venueId: ObjectId, channel: OtpChannel, contact: string): Promise<number> {
  const { value } = await tryRedis(() => redis.pttl(otpCapKey(venueId, channel, contact)), 60_000);
  return value;
}

interface OtpChallengeFields {
  readonly codeHash: string;
  readonly channel: OtpChannel;
  readonly contact: string;
  readonly requestsCount: number;
}

// A new request overwrites codeHash and resets attempts/verified, but the
// requests counter lives in the separate cap key above and is untouched
// here. Atomic HSET + PEXPIRE in one round trip via the otpChallengeWrite
// Lua command: a separate HSET-then-PEXPIRE pair left a crash-between-calls
// window where the challenge hash never expired.
export async function writeOtpChallenge(
  venueId: ObjectId,
  verificationId: string,
  fields: OtpChallengeFields,
  ttlMs: number,
): Promise<{ degraded: boolean }> {
  const key = otpKey(venueId, verificationId);
  const { degraded } = await tryRedis(
    () => redis.otpChallengeWrite(1, key, fields.codeHash, fields.channel, fields.contact, String(fields.requestsCount), ttlMs),
    0,
  );
  return { degraded };
}

export type OtpVerifyOutcome = "OK" | "INVALID" | "EXPIRED" | "TOOMANY";

// Atomic: GET -> attempt-cap check -> HINCRBY -> compare -> HSET verified,
// all in one round trip via the otpVerify Lua command (libs/redis/index.ts),
// so two concurrent verifies cannot both read "0 attempts so far".
export async function verifyOtpCode(
  venueId: ObjectId,
  verificationId: string,
  codeHash: string,
): Promise<{ outcome: OtpVerifyOutcome; degraded: boolean }> {
  const key = otpKey(venueId, verificationId);
  const { value, degraded } = await tryRedis(() => redis.otpVerify(1, key, codeHash), "EXPIRED" as OtpVerifyOutcome);
  return { outcome: value, degraded };
}

export interface OtpVerification {
  readonly verified: boolean;
  readonly channel: OtpChannel;
  readonly contact: string;
}

// The confirm-gate read (booking/controller.ts). Unlike the hold check it
// sits beside, this gate does NOT degrade open: OTP is now a required
// Redis-backed gate (spec section 0), a deliberate availability tradeoff.
// value === null covers both "Redis reachable but the key is gone"
// (expired or already consumed) and is distinguished from `degraded`
// (Redis unreachable) by the caller, which maps each to a different error.
export async function getOtpVerification(
  venueId: ObjectId,
  verificationId: string,
): Promise<{ value: OtpVerification | null; degraded: boolean }> {
  const key = otpKey(venueId, verificationId);
  const { value, degraded } = await tryRedis(() => redis.hgetall(key), null);
  if (degraded) return { value: null, degraded: true };
  if (!value || Object.keys(value).length === 0) return { value: null, degraded: false };
  // Validate the raw hash rather than casting it: a record with a missing
  // contact or a channel outside the known union is not a usable
  // verification. Treat it the same as "key is gone" (null) so the gate
  // yields 410, instead of ever writing an empty contact onto a booking.
  if ((value.channel !== "email" && value.channel !== "sms") || !value.contact) {
    return { value: null, degraded: false };
  }
  return {
    value: {
      verified: value.verified === "1",
      channel: value.channel,
      contact: value.contact,
    },
    degraded: false,
  };
}

// Fire-and-forget, beside releaseHold at the confirm callsite: a failure
// here just leaves the TTL as the backstop.
export async function deleteOtpChallenge(venueId: ObjectId, verificationId: string): Promise<void> {
  await tryRedis(() => redis.del(otpKey(venueId, verificationId)), 0);
}
