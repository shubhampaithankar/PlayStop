import { createHash, randomInt, randomUUID } from "node:crypto";
import type { ObjectId } from "mongodb";
import type { OtpChannel } from "@playstop/engine";
import { env } from "#env.js";
import { redis, tryRedis } from "#libs/redis/index.js";
import { OTP_TTL_MS } from "#modules/otp/constants.js";
import type { OtpChallengeFields, OtpVerification, OtpVerifyOutcome } from "#types/otp.js";

export function otpKey(venueId: ObjectId, verificationId: string): string {
  return `ps:${env.APP_ENV}:${venueId.toHexString()}:otp:${verificationId}`;
}

export function otpCapKey(venueId: ObjectId, channel: OtpChannel, contact: string): string {
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

export async function verifyOtpCode(
  venueId: ObjectId,
  verificationId: string,
  codeHash: string,
): Promise<{ outcome: OtpVerifyOutcome; degraded: boolean }> {
  const key = otpKey(venueId, verificationId);
  const { value, degraded } = await tryRedis(() => redis.otpVerify(1, key, codeHash), "EXPIRED" as OtpVerifyOutcome);
  return { outcome: value, degraded };
}

export async function getOtpVerification(
  venueId: ObjectId,
  verificationId: string,
): Promise<{ value: OtpVerification | null; degraded: boolean }> {
  const key = otpKey(venueId, verificationId);
  const { value, degraded } = await tryRedis(() => redis.hgetall(key), null);
  if (degraded) return { value: null, degraded: true };
  if (!value || Object.keys(value).length === 0) return { value: null, degraded: false };
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

export async function deleteOtpChallenge(venueId: ObjectId, verificationId: string): Promise<void> {
  await tryRedis(() => redis.del(otpKey(venueId, verificationId)), 0);
}
