/**
 * In-memory cache for resolved place display names.
 * Keyed by placeId / canonicalPlaceId / originalName + language.
 */

export type CachedLocalizedPlaceName = {
  placeId?: string;
  canonicalPlaceId?: string;
  originalName: string;
  englishName?: string;
  localizedDisplayName: string;
  requestedLocale?: string;
  languageCode: string;
  resolvedLanguage?: string;
  localizationSource: string;
  translationConfidence: number;
  translatedAt: number;
  countryCode?: string;
  cachedAt: number;
};

const cache = new Map<string, CachedLocalizedPlaceName>();

export function buildLocalizedPlaceNameCacheKey(input: {
  placeId?: string | null;
  canonicalPlaceId?: string | null;
  originalName?: string | null;
  languageCode?: string | null;
  countryCode?: string | null;
}): string {
  const lang = (input.languageCode ?? "zh-TW").trim() || "zh-TW";
  const placeId = (input.placeId ?? input.canonicalPlaceId ?? "").trim();
  if (placeId) return `pid:${placeId}|${lang}`;
  const name = (input.originalName ?? "").trim().toLowerCase();
  const country = (input.countryCode ?? "").trim().toUpperCase();
  return `name:${name}|${country}|${lang}`;
}

export function getLocalizedPlaceNameCache(
  key: string,
): CachedLocalizedPlaceName | null {
  return cache.get(key) ?? null;
}

export function setLocalizedPlaceNameCache(
  key: string,
  value: Omit<CachedLocalizedPlaceName, "cachedAt" | "translatedAt"> & {
    translatedAt?: number;
  },
): CachedLocalizedPlaceName {
  const now = Date.now();
  const entry: CachedLocalizedPlaceName = {
    ...value,
    resolvedLanguage: value.resolvedLanguage ?? value.languageCode,
    translatedAt: value.translatedAt ?? now,
    cachedAt: now,
  };
  cache.set(key, entry);
  return entry;
}

export function clearLocalizedPlaceNameCache(): void {
  cache.clear();
}
