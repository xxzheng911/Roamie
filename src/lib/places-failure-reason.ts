/** Public-safe diagnostics only. Never return arbitrary error text or identifiers. */
export const placesFailureReasons = [
  'ip_rate_limited', 'user_rate_limited', 'guest_rate_limited',
  'global_budget_limited', 'provider_rate_limited', 'cooldown_skipped',
  'stale_generation', 'deadline_exceeded', 'provider_error',
] as const;
export type PlacesFailureReason = typeof placesFailureReasons[number];
export function fixedPlacesFailureReason(value: unknown): PlacesFailureReason | undefined {
  const v = value as { reason?: unknown; error?: unknown; message?: unknown } | null;
  if (v && typeof v === 'object' && placesFailureReasons.includes(v.reason as PlacesFailureReason)) {
    return v.reason as PlacesFailureReason;
  }
  const text = typeof value === 'string' ? value
    : typeof v?.error === 'string' ? v.error
    : typeof v?.message === 'string' ? v.message : '';
  for (const reason of placesFailureReasons) {
    if (new RegExp(`(?:^|[^a-z_])${reason}(?:$|[^a-z_])`).test(text)) return reason;
  }
  if (/\bRESOURCE_EXHAUSTED\b/.test(text)) return 'provider_rate_limited';
  return undefined;
}
