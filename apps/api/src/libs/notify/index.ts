import type { OtpChannel } from "@playstop/engine";
import { env } from "#env.js";

export interface NotifyMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Notifier {
  send(message: NotifyMessage): Promise<void>;
}

const from = env.MESSAGE_FROM ?? "PlayStop";

function logNotifier(channel: OtpChannel): Notifier {
  return {
    // ponytail: log-only channel adapter; drop a provider client behind
    // this interface when funded (Resend is out, free India SMS doesn't
    // exist -- portfolio project ships mock delivery for both channels).
    async send(message: NotifyMessage): Promise<void> {
      console.log(
        JSON.stringify({
          level: "info",
          event: "notify_send",
          channel,
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        }),
      );
    },
  };
}

export const emailNotifier: Notifier = logNotifier("email");
export const smsNotifier: Notifier = logNotifier("sms");

export function notifyFor(channel: OtpChannel): Notifier {
  return channel === "email" ? emailNotifier : smsNotifier;
}
