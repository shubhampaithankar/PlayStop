import { test } from "node:test";
import assert from "node:assert/strict";
import { otpRequestSchema, otpVerifySchema } from "@playstop/engine";

test("email contact is lowercased and trimmed", () => {
  const parsed = otpRequestSchema.parse({ contact: { channel: "email", email: "  Player@Example.COM " } });
  assert.deepEqual(parsed.contact, { channel: "email", email: "player@example.com" });
});

test("phone transform keeps the last 10 digits of a bare number starting with 91", () => {
  const parsed = otpRequestSchema.parse({ contact: { channel: "sms", phone: "9187654321" } });
  assert.deepEqual(parsed.contact, { channel: "sms", phone: "9187654321" });
});

test("phone transform strips a +91 country-code prefix", () => {
  const parsed = otpRequestSchema.parse({ contact: { channel: "sms", phone: "+919876543210" } });
  assert.deepEqual(parsed.contact, { channel: "sms", phone: "9876543210" });
});

test("phone transform strips a bare 91 country-code prefix", () => {
  const parsed = otpRequestSchema.parse({ contact: { channel: "sms", phone: "919876543210" } });
  assert.deepEqual(parsed.contact, { channel: "sms", phone: "9876543210" });
});

test("phone tolerates spaces inside the number", () => {
  const parsed = otpRequestSchema.parse({ contact: { channel: "sms", phone: "98765 43210" } });
  assert.deepEqual(parsed.contact, { channel: "sms", phone: "9876543210" });
});

test("phone tolerates hyphens and a +91 prefix together", () => {
  const parsed = otpRequestSchema.parse({ contact: { channel: "sms", phone: "+91 98765-43210" } });
  assert.deepEqual(parsed.contact, { channel: "sms", phone: "9876543210" });
});

test("a contact missing its channel's own field is rejected", () => {
  assert.throws(() => otpRequestSchema.parse({ contact: { channel: "email", phone: "9876543210" } }));
});

test("an invalid phone is rejected", () => {
  assert.throws(() => otpRequestSchema.parse({ contact: { channel: "sms", phone: "12345" } }));
});

test("otpVerifySchema requires a verificationId and a 6-digit code", () => {
  const parsed = otpVerifySchema.parse({ verificationId: "550e8400-e29b-41d4-a716-446655440000", code: "123456" });
  assert.equal(parsed.code, "123456");
  assert.throws(() => otpVerifySchema.parse({ verificationId: "not-a-uuid", code: "123456" }));
});
