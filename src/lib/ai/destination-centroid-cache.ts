/**
 * Generic city-centroid cache for successful destination resolutions.
 * Shared by Destination Anchor and geocode paths — not a hardcoded hub table.
 */
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveDestinationAlias } from "@/lib/ai/destination-alias-resolver";

type CityCentroidCacheEntry = {
  latitude: number;
  longitude: number;
  country?: string;
  countryCode?: string;
  at: number;
};

const CITY_CENTROID_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cityCentroidCache = new Map<string, CityCentroidCacheEntry>();

function canonicalKey(destination: string, countryCode?: string): string {
  const alias = resolveDestinationAlias(destination, {
    countryHint: countryCode,
  });
  const label = normalizeDestinationLabel(alias.normalizedName || destination);
  const cc = (countryCode ?? alias.countryCode ?? "").trim().toUpperCase();
  return cc ? `${label}|${cc}` : label;
}

export function rememberCityCentroid(params: {
  destination: string;
  latitude: number;
  longitude: number;
  country?: string;
  countryCode?: string;
}): void {
  const alias = resolveDestinationAlias(params.destination, {
    countryHint: params.country ?? params.countryCode,
  });
  const label = normalizeDestinationLabel(alias.normalizedName || params.destination);
  if (!label) return;
  // Never cache empty / invalid coordinates (negative cache forbidden).
  if (
    typeof params.latitude !== "number" ||
    typeof params.longitude !== "number" ||
    !Number.isFinite(params.latitude) ||
    !Number.isFinite(params.longitude) ||
    params.latitude < -90 ||
    params.latitude > 90 ||
    params.longitude < -180 ||
    params.longitude > 180
  ) {
    return;
  }
  const entry: CityCentroidCacheEntry = {
    latitude: params.latitude,
    longitude: params.longitude,
    country: params.country ?? alias.countryHint,
    countryCode: params.countryCode ?? alias.countryCode,
    at: Date.now(),
  };
  const cc = params.countryCode ?? alias.countryCode;
  cityCentroidCache.set(canonicalKey(label, cc), entry);
  cityCentroidCache.set(canonicalKey(label), entry);
  // Alias synonyms share the same positive entry (熊本 / 熊本市 / Kumamoto).
  for (const syn of alias.aliases.slice(0, 8)) {
    const synLabel = normalizeDestinationLabel(syn);
    if (!synLabel || synLabel === label) continue;
    cityCentroidCache.set(canonicalKey(synLabel, cc), entry);
    cityCentroidCache.set(canonicalKey(synLabel), entry);
  }
}

export function readCityCentroidCache(
  destination: string,
  countryCode?: string,
): CityCentroidCacheEntry | null {
  const now = Date.now();
  for (const key of [canonicalKey(destination, countryCode), canonicalKey(destination)]) {
    const entry = cityCentroidCache.get(key);
    if (!entry) continue;
    if (now - entry.at > CITY_CENTROID_TTL_MS) {
      cityCentroidCache.delete(key);
      continue;
    }
    if (!Number.isFinite(entry.latitude) || !Number.isFinite(entry.longitude)) {
      cityCentroidCache.delete(key);
      continue;
    }
    return entry;
  }
  return null;
}

export function clearCityCentroidCache(destination?: string): void {
  if (!destination) {
    cityCentroidCache.clear();
    return;
  }
  const alias = resolveDestinationAlias(destination);
  const names = new Set(
    [alias.normalizedName, destination, ...alias.aliases]
      .map((n) => normalizeDestinationLabel(n))
      .filter(Boolean),
  );
  for (const key of [...cityCentroidCache.keys()]) {
    const destPart = key.split("|")[0] ?? key;
    if (names.has(destPart)) cityCentroidCache.delete(key);
  }
}
