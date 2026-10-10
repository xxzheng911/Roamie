import type { TripLocation } from "./types";

/** Backward-compatible authority: canonical provider identity, country and finite geometry. */
export function isResolvedDestination(value: TripLocation | null | undefined): value is TripLocation {
  return Boolean(value?.placeId?.trim() && value.country?.trim() &&
    Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 &&
    Number.isFinite(value.lng) && Math.abs(value.lng) <= 180);
}

export async function resolveDestinationAuthority(
  existing: TripLocation | null | undefined,
  label: string,
  resolve: (label: string) => Promise<TripLocation | null>,
): Promise<TripLocation | undefined> {
  if (isResolvedDestination(existing)) return existing;
  if (!label.trim()) return undefined;
  try {
    const result = await resolve(label.trim());
    return isResolvedDestination(result) ? result : undefined;
  } catch { return undefined; }
}
