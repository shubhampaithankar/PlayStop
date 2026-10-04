export interface CountdownState {
  readonly remainingMs: number;
  readonly label: string;
  readonly urgent: boolean;
  readonly expired: boolean;
}

export function remainingMsUntil(expiresAt: string, nowMs: number): number {
  return Math.max(0, Date.parse(expiresAt) - nowMs);
}

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
