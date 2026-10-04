import { z } from "zod";
import { isoInstantSchema } from "../primitives/index.js";

const INDIA_PHONE_PATTERN = /^(\+?91)?[6-9]\d{9}$/;
const OTP_CODE_PATTERN = /^\d{6}$/;

const emailContactSchema = z.object({
  channel: z.literal("email"),
  email: z.string().trim().toLowerCase().email(),
});

const smsContactSchema = z.object({
  channel: z.literal("sms"),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ""))
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
  devCode: z.string().regex(OTP_CODE_PATTERN).optional(),
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
