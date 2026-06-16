import type { Locale } from "@/lib/i18n/types";

type IntroPayload = {
  intro: string;
  suitableFor: string;
  weatherFit: string;
  goNowAdvice: string;
};

const cache = new Map<string, { at: number; data: IntroPayload }>();
const TTL_MS = 24 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<IntroPayload | null>>();

function cacheKey(placeId: string, locale: Locale, reason?: string): string {
  return `${locale}:${placeId}:${(reason ?? "").slice(0, 80)}`;
}

export function readPlaceIntroCache(
  placeId: string,
  locale: Locale,
  reason?: string,
): IntroPayload | null {
  const key = cacheKey(placeId, locale, reason);
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) return null;
  return hit.data;
}

export function writePlaceIntroCache(
  placeId: string,
  locale: Locale,
  reason: string | undefined,
  data: IntroPayload,
): void {
  cache.set(cacheKey(placeId, locale, reason), { at: Date.now(), data });
}

export function getPlaceIntroInFlight(
  placeId: string,
  locale: Locale,
  reason?: string,
): Promise<IntroPayload | null> | null {
  return inFlight.get(cacheKey(placeId, locale, reason)) ?? null;
}

export function setPlaceIntroInFlight(
  placeId: string,
  locale: Locale,
  reason: string | undefined,
  promise: Promise<IntroPayload | null>,
): void {
  const key = cacheKey(placeId, locale, reason);
  inFlight.set(key, promise);
  void promise.finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
}
