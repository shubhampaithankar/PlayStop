import { z } from "zod";
import { isoInstantSchema } from "../primitives/index.js";

// Strict, unlike player.phone (loose intl, contracts/booking): an OTP is
// actually sent (mocked) to this number, so the format has to be real.
// 10 digits, optionally prefixed with a country code, first digit 6-9.
const INDIA_PHONE_PATTERN = /^(\+?91)?[6-9]\d{9}$/;
const OTP_CODE_PATTERN = /^\d{6}$/;

// Discriminated union: the customer picks a channel, and each branch
// carries exactly the field that channel needs. email lowercased so the
// same address always hashes to the same request-cap key.
const emailContactSchema = z.object({
  channel: z.literal("email"),
  email: z.string().trim().toLowerCase().email(),
});

// The regex already guarantees the last 10 digits are the subscriber
// number, so slice rather than strip a leading "91" prefix: a bare
// 10-digit number that happens to start with 91 (e.g. 9187654321) is a
// real subscriber number, not a country code + shorter number, and
// .replace(/^\+?91/, "") would wrongly mangle it to 8 digits.
const smsContactSchema = z.object({
  channel: z.literal("sms"),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, "")) // tolerate separators ("98765 43210", "98765-43210"); digit rule below is unchanged
    .pipe(z.string().regex(INDIA_PHONE_PATTERN))
    .transform((value) => value.slice(-10)),
});

export const otpContactSchema = z.discriminatedUnion("channel", [emailContactSchema, smsContactSchema]);
export type OtpContact = z.infer<typeof otpContactSchema>;
export type OtpChannel = OtpContact["channel"];

export const otpRequestSchema = z.object({
  contact: otpContactSchema,
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const otpRequestResponseSchema = z.object({
  verificationId: z.string().uuid(),
  expiresAt: isoInstantSchema,
  devCode: z.string().regex(OTP_CODE_PATTERN).optional(), // present only when MOCK_OTP=true
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

export const otpVerifySchema = z.object({
  verificationId: z.string().uuid(),
  code: z.string().regex(OTP_CODE_PATTERN),
});
export type OtpVerify = z.infer<typeof otpVerifySchema>;

export const otpVerifyResponseSchema = z.object({
  verified: z.literal(true),
});
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponseSchema>;
