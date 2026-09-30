// `/bookings/find` -- look up every booking made with a contact by proving you
// own it: the same /otp/request + /otp/verify the confirm step uses, then a
// read-only POST /bookings/lookup keyed on the verified id. The server takes
// the contact from the verified record, never from this page.
//
// Relative .js-extension imports for the same reason as routes/root.tsx.
import { useState } from "react";
import { createRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { otpContactSchema } from "@playstop/engine";
import type { BookingResponse, OtpChannel, OtpContact } from "@playstop/engine";
import { rootRoute } from "./root.js";
import { venueOptions } from "../lib/query-client.js";
import { ApiRequestError, errorPresentation, lookupBookings, requestOtp, verifyOtp } from "../lib/api.js";
import { instantLabel } from "../lib/stations.js";
import { currentBusinessDate, businessDateLabel } from "../lib/business-date.js";
import {
  ChannelToggle,
  FieldError,
  FOCUS_RING,
  Notice,
  PhoneField,
  SkeletonBox,
  StepHeading,
  TextField,
  UNDERLINE_LINK,
} from "../components/screen-ui.js";

function errorMessage(err: unknown): string {
  return err instanceof ApiRequestError
    ? err.message || errorPresentation[err.code].detail
    : "Could not reach the server. Check your connection.";
}

const PRIMARY_BUTTON = `pressable btn-go h-12 rounded-(--radius) text-base font-semibold disabled:opacity-50 ${FOCUS_RING}`;

function BookingsFindScreen() {
  const venueQuery = useQuery(venueOptions());
  const venue = venueQuery.data;
  const [nowMs] = useState(() => Date.now());

  const [channel, setChannel] = useState<OtpChannel>("sms");
  const [emailValue, setEmailValue] = useState("");
  const [phoneValue, setPhoneValue] = useState("");
  const [contactError, setContactError] = useState<string | undefined>(undefined);
  const [challenge, setChallenge] = useState<{
    verificationId: string;
    devCode: string | undefined;
    contact: OtpContact;
  } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [results, setResults] = useState<BookingResponse[] | null>(null);

  async function handleSendCode() {
    const raw = (channel === "email" ? emailValue : phoneValue).trim();
    // Same schema as the confirm step: same India-phone pattern and normalization.
    const parsed = otpContactSchema.safeParse(
      channel === "email" ? { channel: "email", email: raw } : { channel: "sms", phone: raw },
    );
    if (!parsed.success) {
      setContactError(channel === "email" ? "Enter a valid email address." : "Enter the 10 digits after +91.");
      return;
    }
    setBusy(true);
    setPanelError(null);
    try {
      const res = await requestOtp({ contact: parsed.data });
      setCode("");
      setChallenge({ verificationId: res.verificationId, devCode: res.devCode, contact: parsed.data });
    } catch (err) {
      setPanelError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!challenge) return;
    setBusy(true);
    setPanelError(null);
    try {
      const verified = await verifyOtp({ verificationId: challenge.verificationId, code: code.trim() });
      if (!verified.verified) return;
      const found = await lookupBookings({ verificationId: challenge.verificationId });
      setResults(found.bookings);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "OTP_INVALID") {
        setPanelError("Wrong code. Try again.");
      } else if (err instanceof ApiRequestError && err.code === "OTP_EXPIRED") {
        // Code timed out: back to the form to get a fresh one.
        setChallenge(null);
        setPanelError("That code expired. Send a new one.");
      } else {
        setPanelError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const contactLabel = challenge
    ? challenge.contact.channel === "email"
      ? challenge.contact.email
      : `+91 ${challenge.contact.phone}`
    : "";

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-8 md:px-6">
      <StepHeading step="Your bookings" title="Find my bookings" />

      {results !== null ? (
        venueQuery.isError ? (
          <Notice tone="destructive">{errorMessage(venueQuery.error)}</Notice>
        ) : !venue ? (
          <SkeletonBox className="h-32 w-full rounded-(--radius-card)" />
        ) : results.length === 0 ? (
          <Notice>No bookings found for {contactLabel}.</Notice>
        ) : (
          <ul className="flex flex-col gap-3">
            {results.map((booking) => {
              const dateLabel = businessDateLabel(
                venue,
                new Date(nowMs),
                currentBusinessDate(venue, new Date(booking.startsAt)),
              );
              return (
                <li key={booking.id}>
                  <Link
                    to="/booking/$bookingId"
                    params={{ bookingId: booking.id }}
                    search={{ code: booking.confirmationCode }}
                    className={`pressable border-border flex flex-col gap-1 rounded-(--radius-card) border p-4 ${FOCUS_RING}`}
                  >
                    <span className="text-base font-semibold">{booking.stationName}</span>
                    <span className="text-muted-foreground text-sm">
                      {dateLabel}, {instantLabel(booking.startsAt, venue.timezone)} to{" "}
                      {instantLabel(booking.endsAt, venue.timezone)}
                    </span>
                    <span className="flex items-center justify-between text-sm">
                      <code className="font-mono">{booking.confirmationCode}</code>
                      <span className={booking.status === "cancelled" ? "text-destructive" : "text-muted-foreground"}>
                        {booking.status === "cancelled" ? "Cancelled" : "Confirmed"}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )
      ) : challenge ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <span>
              Code sent to <span className="font-medium">{contactLabel}</span>
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setPanelError(null);
              }}
              className={`text-muted-foreground hover:text-foreground -my-2.5 ${UNDERLINE_LINK}`}
            >
              Change
            </button>
          </div>
          {challenge.devCode ? (
            <Notice>
              Mock code, dev only: <span className="font-mono font-semibold">{challenge.devCode}</span>
            </Notice>
          ) : null}
          {panelError ? <Notice tone="destructive">{panelError}</Notice> : null}
          <form action={() => void handleVerify()} className="flex flex-col gap-3">
            <TextField
              id="find-otp-code"
              label="Code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              required
              autoFocus
              disabled={busy}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            />
            <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
              {busy ? "Checking…" : "Verify and find"}
            </button>
          </form>
        </div>
      ) : (
        <form action={() => void handleSendCode()} className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            Enter the email or mobile number you booked with. We send a code to prove it is yours.
          </p>
          {panelError ? <Notice tone="destructive">{panelError}</Notice> : null}
          <ChannelToggle
            value={channel}
            onValueChange={(next) => {
              setChannel(next);
              setContactError(undefined);
            }}
            disabled={busy}
          />
          {channel === "email" ? (
            <TextField
              id="find-contact"
              label="Email"
              name="contact"
              type="email"
              inputMode="email"
              placeholder="you@example.com"
              required
              disabled={busy}
              value={emailValue}
              onChange={(event) => {
                setEmailValue(event.target.value);
                setContactError(undefined);
              }}
              aria-invalid={contactError ? true : undefined}
              aria-describedby={contactError ? "find-contact-error" : undefined}
            />
          ) : (
            <PhoneField
              id="find-contact"
              label="Mobile number"
              value={phoneValue}
              onValueChange={(value) => {
                setPhoneValue(value);
                setContactError(undefined);
              }}
              disabled={busy}
              invalid={Boolean(contactError)}
              describedBy={contactError ? "find-contact-error" : undefined}
            />
          )}
          <FieldError id="find-contact-error" message={contactError} />
          <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      )}

      <Link to="/bookings" className={UNDERLINE_LINK}>
        Back to your bookings
      </Link>
    </main>
  );
}

export const bookingsFindRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bookings/find",
  component: BookingsFindScreen,
});
