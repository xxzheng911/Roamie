let current = () => Date.now();

export function guardNow(): number {
  return current();
}

/** Test-only clock. Production builds cannot replace it. */
export function setAbuseGuardClockForTests(fn: (() => number) | null): void {
  if (import.meta.env?.PROD === true) throw new Error("test_context_forbidden");
  current = fn ?? (() => Date.now());
}

export function utcDay(now = guardNow()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function secondsUntilUtcMidnight(now = guardNow()): number {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

export function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}
