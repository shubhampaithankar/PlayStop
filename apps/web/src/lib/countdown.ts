// Countdown derivation for screen 4's "This spot is yours for..." sentence
// (DESIGN.md section 4; milestone-3-spec.md section 5 "The countdown").
// remainingMs is always derived from expiresAt against a passed-in `nowMs`,
// never decremented by a timer -- the timer is a tick source only.
export interface CountdownState {
  readonly remainingMs: number;
  readonly label: string; // "4:32"
  /** Under 60s: digits turn red, copy switches to "Hurry, ...". */
  readonly urgent: boolean;
  readonly expired: boolean;
}

export function remainingMsUntil(expiresAt: string, nowMs: number): number {
  return Math.max(0, Date.parse(expiresAt) - nowMs);
}

/** "4:32", "0:41", "0:00". Minutes are unbounded (no hour rollover needed:
 *  HOLD_TTL_SECONDS is a few minutes). */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function countdownState(expiresAt: string, nowMs: number): CountdownState {
  const remainingMs = remainingMsUntil(expiresAt, nowMs);
  return {
    remainingMs,
    label: formatCountdown(remainingMs),
    urgent: remainingMs > 0 && remainingMs < 60_000,
    expired: remainingMs === 0,
  };
}
