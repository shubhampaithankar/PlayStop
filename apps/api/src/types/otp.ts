import type { OtpChannel } from "@playstop/engine";

export interface OtpChallengeFields {
  readonly codeHash: string;
  readonly channel: OtpChannel;
  readonly contact: string;
  readonly requestsCount: number;
}

export type OtpVerifyOutcome = "OK" | "INVALID" | "EXPIRED" | "TOOMANY";

export interface OtpVerification {
  readonly verified: boolean;
  readonly channel: OtpChannel;
  readonly contact: string;
}
