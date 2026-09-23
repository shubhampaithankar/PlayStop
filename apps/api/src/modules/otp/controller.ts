import type { Request, Response } from "express";
import { ERROR_CODES, otpRequestSchema, otpVerifySchema, type OtpRequestResponse, type OtpVerifyResponse } from "@playstop/engine";
import { env } from "#env.js";
import { DomainError } from "#errors.js";
import { requireVenue } from "#middleware/venue.js";
import { notifyFor } from "#libs/notify/index.js";
import {
  generateMockCode,
  hashOtpCode,
  incrementOtpRequestCount,
  mintVerificationId,
  OTP_REQUEST_CAP,
  OTP_TTL_MS,
  otpCapPttlMs,
  verifyOtpCode,
  writeOtpChallenge,
} from "#modules/otp/data.js";

function contactValue(contact: { channel: "email"; email: string } | { channel: "sms"; phone: string }): string {
  return contact.channel === "email" ? contact.email : contact.phone;
}

export async function requestOtp(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const parsed = otpRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 400, "Invalid OTP request.", parsed.error.flatten());
  }
  const { contact } = parsed.data;
  const contactStr = contactValue(contact);

  const { count: requestsCount, degraded: countDegraded } = await incrementOtpRequestCount(
    venue._id,
    contact.channel,
    contactStr,
  );
  if (countDegraded) {
    throw new DomainError(ERROR_CODES.OTP_REQUIRED, 403, "OTP verification is temporarily unavailable.");
  }
  if (requestsCount > OTP_REQUEST_CAP) {
    const retryAfterMs = await otpCapPttlMs(venue._id, contact.channel, contactStr);
    throw new DomainError(ERROR_CODES.OTP_TOO_MANY, 429, "Too many OTP requests for this contact.", undefined, {
      "Retry-After": String(Math.max(1, Math.ceil((retryAfterMs > 0 ? retryAfterMs : 60_000) / 1000))),
    });
  }

  const verificationId = mintVerificationId();
  const code = generateMockCode();
  const codeHash = hashOtpCode(verificationId, code);

  const { degraded: writeDegraded } = await writeOtpChallenge(
    venue._id,
    verificationId,
    { codeHash, channel: contact.channel, contact: contactStr, requestsCount },
    OTP_TTL_MS,
  );
  if (writeDegraded) {
    throw new DomainError(ERROR_CODES.OTP_REQUIRED, 403, "OTP verification is temporarily unavailable.");
  }

  // Fire-and-forget: the mock send is logged so the delivery path is
  // exercised, but a notifier failure must never fail the OTP request --
  // the devCode below (MOCK_OTP) is the real path a developer uses anyway.
  notifyFor(contact.channel)
    .send({ to: contactStr, subject: "Your PlayStop verification code", text: `Your code is ${code}. It expires in 10 minutes.` })
    .catch(() => {});

  const body: OtpRequestResponse = {
    verificationId,
    expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    ...(env.MOCK_OTP ? { devCode: code } : {}),
  };
  res.status(200).json(body);
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const venue = requireVenue(req);
  const parsed = otpVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 400, "Invalid OTP verify request.", parsed.error.flatten());
  }
  const { verificationId, code } = parsed.data;
  const codeHash = hashOtpCode(verificationId, code);

  const { outcome, degraded } = await verifyOtpCode(venue._id, verificationId, codeHash);
  if (degraded) {
    throw new DomainError(ERROR_CODES.OTP_REQUIRED, 403, "OTP verification is temporarily unavailable.");
  }
  if (outcome === "EXPIRED") {
    throw new DomainError(ERROR_CODES.OTP_EXPIRED, 410, "That code has expired.");
  }
  if (outcome === "TOOMANY") {
    // ponytail: no Retry-After header here -- attempts never reset without
    // a new /otp/request, so any fixed value would be fictional. Add one
    // once there's a real reset condition (e.g. attempts tied to the TTL).
    throw new DomainError(ERROR_CODES.OTP_TOO_MANY, 429, "Too many attempts.");
  }
  if (outcome === "INVALID") {
    throw new DomainError(ERROR_CODES.OTP_INVALID, 422, "That code is incorrect.");
  }

  const body: OtpVerifyResponse = { verified: true };
  res.status(200).json(body);
}
