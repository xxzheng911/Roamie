import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { ChatPlaceItem } from "@/lib/chat-session";
import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import { normalizeGooglePlaceId, normalizeGooglePlace } from "@/lib/ai/normalize-google-place";
import {
  isRealGooglePlanningPlace,
  isResolvedCorePlace,
  isResolvedGooglePlace,
} from "@/lib/ai/planning-real-place";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { distanceMeters } from "@/lib/map-explore";
import {
  createPlaceMapDedupeScope,
  mapWithConcurrencyLimit,
  PLACE_MAP_MAX_CONCURRENCY,
  rateLimitBackoffMs,
  type PlaceMapDedupeScope,
} from "@/lib/ai/place-map-queue";
import {
  canRetryPlacesRequest,
  markPlacesRequestRetried,
  markPlacesResolved,
  notePlacesRateLimited,
  waitForPlacesGenerationCooldown,
} from "@/lib/places-api-guard";

const MAX_SEARCH_RETRIES = 2;
const MAX_DISTANCE_FROM_DESTINATION_M = 45_000;

export type FetchPlaceDetailsByIdFn = (
  placeId: string,
) => Promise<PlaceResult | null>;

function isRealGoogleId(id: string | undefined | null): boolean {
  const normalized = normalizeGooglePlaceId(id);
  if (!normalized || !isHardGooglePlaceId(normalized)) return false;
  if (/^(session:|trip:|memory:|synthetic:|latlng:|saved-|name:)/i.test(normalized)) {
    return false;
  }
  return /^ChIJ[\w-]+$/i.test(normalized);
}

import { mergeCombinationProvenance } from "@/lib/ai/combination-provenance";

function placeToChatItem(
  place: PlaceResult,
  context: CanonicalTravelContext,
  locale: Locale,
  provenance?: {
    sourceCombinationId?: number;
    sourceCombinationIds?: number[];
    matchedCombinationIds?: number[];
    matchedSelectedCombinationIds?: number[];
  },
): ChatPlaceItem {
  const item = mapPlaceResultToChatItem(place, {
    mood: context.mood,
    weather: context.weather,
    locale,
  });
  if (!provenance) return item;
  return mergeCombinationProvenance(
    {
      ...item,
      sourceCombinationId: provenance.sourceCombinationId ?? item.sourceCombinationId,
      sourceCombinationIds: provenance.sourceCombinationIds ?? item.sourceCombinationIds,
      matchedCombinationIds:
        provenance.matchedCombinationIds ?? item.matchedCombinationIds,
      matchedSelectedCombinationIds:
        provenance.matchedSelectedCombinationIds ?? item.matchedSelectedCombinationIds,
    },
    provenance.sourceCombinationIds ??
      provenance.matchedSelectedCombinationIds ??
      (provenance.sourceCombinationId != null ? [provenance.sourceCombinationId] : []),
  );
}

function normalizeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

function nameSimilarityScore(candidate: string, target: string): number {
  const a = normalizeNameKey(candidate);
  const b = normalizeNameKey(target);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  let shared = 0;
  const chars = new Set(b);
  for (const ch of a) {
    if (chars.has(ch)) shared += 1;
  }
  return shared / Math.max(a.length, b.length);
}

function destinationInAddress(address: string | null | undefined, destination: string): boolean {
  if (!address?.trim()) return false;
  const addr = address.replace(/\s+/g, "");
  const dest = destination.replace(/\s+/g, "");
  if (!dest) return true;
  if (addr.includes(dest)) return true;
  if (dest.includes("台") && addr.includes(dest.replace(/台/g, "臺"))) return true;
  if (dest.includes("臺") && addr.includes(dest.replace(/臺/g, "台"))) return true;
  return false;
}

function pickBestSearchMatch(params: {
  places: PlaceResult[];
  name: string;
  destination: string;
  lat: number;
  lng: number;
}): PlaceResult | null {
  const scored = params.places
    .map((place) => {
      const sim = nameSimilarityScore(place.name ?? "", params.name);
      const inDest = destinationInAddress(place.address, params.destination);
      const dist =
        place.lat != null && place.lng != null
          ? distanceMeters(
              { lat: params.lat, lng: params.lng },
              { lat: place.lat, lng: place.lng },
            )
          : Number.POSITIVE_INFINITY;
      const withinRange = dist <= MAX_DISTANCE_FROM_DESTINATION_M;
      const transit = isForbiddenTransitAttraction(place);
      let score = sim * 10;
      if (inDest) score += 3;
      if (withinRange) score += 2;
      if (place.photoName) score += 0.5;
      if (transit) score -= 20;
      if (!withinRange) score -= 5;
      return { place, score, sim, inDest, withinRange, transit };
    })
    .filter((row) => !row.transit && row.sim >= 0.35 && (row.inDest || row.withinRange))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.place ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One query per attempt — do not fire both name/dest orderings in the same attempt. */
function queryForAttempt(name: string, destination: string, attemptIndex: number): string {
  if (attemptIndex === 0) return `${name} ${destination}`;
  if (attemptIndex === 1) return `${name} ${destination} 景點`;
  return `${destination} ${name}`;
}

async function searchPlaceByName(params: {
  name: string;
  destination: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  attemptIndex: number;
  dedupe?: PlaceMapDedupeScope;
  generationRequestId?: string;
}): Promise<{ place: PlaceResult | null; rateLimited: boolean }> {
  const {
    name,
    destination,
    lat,
    lng,
    locale,
    searchPlaces,
    attemptIndex,
    dedupe,
    generationRequestId,
  } = params;

  const query = queryForAttempt(name, destination, attemptIndex);
  const retryKey = `place_map_search:${generationRequestId ?? "anon"}:${query}`;

  const runSearch = async (): Promise<{ place: PlaceResult | null; rateLimited: boolean }> => {
    await waitForPlacesGenerationCooldown();
    try {
      const result = await searchPlaces({
        data: {
          lat,
          lng,
          locale,
          query,
          mode: "text",
          includedTypes: ["tourist_attraction", "park", "museum", "point_of_interest"],
          radius: 25000,
          searchMode: "destination",
          destinationName: destination,
          placesCaller: "place_map",
          placesScreen: "itinerary",
        },
      });

      if (result.error === "places_rate_limited") {
        logAiPipeline("[PLACE_MAP_RATE_LIMITED]", `query=${query}`);
        notePlacesRateLimited({
          attemptIndex,
          generationRequestId,
        });
        if (canRetryPlacesRequest(retryKey) && attemptIndex < MAX_SEARCH_RETRIES) {
          markPlacesRequestRetried(retryKey, "search");
          await sleep(rateLimitBackoffMs(attemptIndex));
          await waitForPlacesGenerationCooldown();
          return runSearch();
        }
        return { place: null, rateLimited: true };
      }

      const places = (result.places ?? []).filter(
        (p) => isRealGooglePlanningPlace(p) && isRealGoogleId(p.id),
      );
      const best = pickBestSearchMatch({
        places,
        name,
        destination,
        lat,
        lng,
      });
      if (best) {
        return { place: best, rateLimited: false };
      }
      return { place: null, rateLimited: false };
    } catch (e) {
      logAiPipeline(
        "[PLACE_MAP_SEARCH_RETRY]",
        `name=${name}`,
        `attempt=${attemptIndex}`,
        `error=${e instanceof Error ? e.message : String(e)}`,
      );
      return { place: null, rateLimited: false };
    }
  };

  if (dedupe) {
    return dedupe.dedupeQuery(query, runSearch);
  }
  return runSearch();
}

/**
 * Optional enrichment. Detail failure never rejects a resolved core place.
 */
async function enrichWithDetails(
  place: PlaceResult,
  fetchPlaceDetails?: FetchPlaceDetailsByIdFn,
  generationRequestId?: string,
): Promise<{ place: PlaceResult; enriched: boolean }> {
  const id = normalizeGooglePlaceId(place.id);
  if (!isRealGoogleId(id)) return { place, enriched: false };
  if (!fetchPlaceDetails) {
    return { place, enriched: Boolean(place.photoName) };
  }

  const retryKey = `place_map_detail:${generationRequestId ?? "anon"}:${id}`;

  try {
    await waitForPlacesGenerationCooldown();
    const details = await fetchPlaceDetails(id);
    if (!details) {
      logAiPipeline("[PLACE_MAP_DETAIL_SKIP]", `placeId=${id}`, `reason=empty_details`);
      return { place, enriched: false };
    }
    const merged = normalizeGooglePlace(
      {
        ...place,
        ...details,
        id: details.id ?? place.id,
        placeId: details.id ?? place.id,
        googlePlaceId: details.id ?? place.id,
      },
      { existing: place },
    );
    if (!merged || !isResolvedCorePlace(merged)) {
      return { place, enriched: false };
    }
    return { place: merged, enriched: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/429|503|rate.?limit/i.test(msg)) {
      notePlacesRateLimited({ generationRequestId });
      if (canRetryPlacesRequest(retryKey)) {
        markPlacesRequestRetried(retryKey, "detail");
        logAiPipeline("[PLACE_MAP_DETAIL_RETRY]", `name=${place.name}`, `attempt=1`);
        await sleep(rateLimitBackoffMs(0));
        try {
          const details = await fetchPlaceDetails(id);
          if (details) {
            const merged = normalizeGooglePlace(
              { ...place, ...details, id: details.id ?? place.id },
              { existing: place },
            );
            if (merged && isResolvedCorePlace(merged)) {
              return { place: merged, enriched: true };
            }
          }
        } catch {
          /* keep core */
        }
      }
    }
    logAiPipeline(
      "[PLACE_MAP_DETAIL_SOFT_FAIL]",
      `placeId=${id}`,
      `keeping_core=1`,
      `error=${msg.slice(0, 80)}`,
    );
    return { place, enriched: false };
  }
}

function asCorePlace(
  place: PlaceResult,
  destination: string,
): PlaceResult | null {
  const address =
    place.address?.trim() ||
    (place.lat != null && place.lng != null ? `${place.name}, ${destination}` : null);

  const candidate: PlaceResult = {
    ...place,
    address: address ?? place.address,
  };

  if (!isResolvedCorePlace({ ...candidate, destinationMatch: true })) {
    return null;
  }
  return candidate;
}

/**
 * Map a display name → Google Places Text Search (destination-qualified) → optional Detail.
 * Returns resolvedCorePlace even when enrichment fails. Never returns session: ids.
 */
export async function mapNamedPlaceToGoogle(params: {
  name: string;
  destination: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  fetchPlaceDetails?: FetchPlaceDetailsByIdFn;
  candidates?: string[];
  dedupe?: PlaceMapDedupeScope;
  generationRequestId?: string;
}): Promise<PlaceResult | null> {
  const cached = params.dedupe?.getResolvedName<PlaceResult | null>(params.name);
  if (cached !== undefined) return cached;

  const namesToTry = [
    params.name,
    ...(params.candidates ?? []).filter((c) => c && c !== params.name),
  ];

  let sawRateLimit = false;

  for (const candidateName of namesToTry) {
    for (let attempt = 0; attempt < MAX_SEARCH_RETRIES; attempt += 1) {
      const found = await searchPlaceByName({
        name: candidateName,
        destination: params.destination,
        lat: params.lat,
        lng: params.lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        attemptIndex: attempt,
        dedupe: params.dedupe,
        generationRequestId: params.generationRequestId,
      });

      if (found.rateLimited) {
        sawRateLimit = true;
        continue;
      }
      if (!found.place) continue;

      const core = asCorePlace(found.place, params.destination);
      if (!core) continue;

      const { place: maybeEnriched, enriched } = await enrichWithDetails(
        core,
        params.fetchPlaceDetails,
        params.generationRequestId,
      );
      const finalPlace = asCorePlace(maybeEnriched, params.destination) ?? core;

      if (isResolvedCorePlace({ ...finalPlace, destinationMatch: true })) {
        logAiPipeline(
          "[PLACE_MAP_SUCCESS]",
          `name=${params.name}`,
          `mapped=${finalPlace.name}`,
          `placeId=${finalPlace.id}`,
          `enriched=${enriched ? 1 : 0}`,
          `attempt=${attempt + 1}`,
        );
        markPlacesResolved(true);
        params.dedupe?.setResolvedName(params.name, finalPlace);
        return finalPlace;
      }
    }
  }

  logAiPipeline(
    "[PLACE_MAP_FAILED]",
    `name=${params.name}`,
    `destination=${params.destination}`,
    sawRateLimit ? "rate_limited=1" : "rate_limited=0",
  );
  markPlacesResolved(false);
  params.dedupe?.setResolvedName(params.name, null);
  return null;
}

/**
 * Resolve name-only / synthetic session places into real Google places.
 * Uses concurrency-2 queue; drops anything that cannot be mapped as resolvedCorePlace.
 */
export async function mapChatPlacesToGooglePlaces(params: {
  places: ChatPlaceItem[];
  destination: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  fetchPlaceDetails?: FetchPlaceDetailsByIdFn;
  context: CanonicalTravelContext;
  generationRequestId?: string;
  dedupe?: PlaceMapDedupeScope;
}): Promise<ChatPlaceItem[]> {
  const generationRequestId =
    params.generationRequestId ??
    `map_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const dedupe = params.dedupe ?? createPlaceMapDedupeScope(generationRequestId);
  const seenIds = new Set<string>();
  const needsMapping: ChatPlaceItem[] = [];
  const ready: ChatPlaceItem[] = [];

  for (const raw of params.places) {
    const name = (raw.placeName ?? raw.name ?? "").trim();
    if (!name) continue;

    const existingId = normalizeGooglePlaceId(raw.googlePlaceId ?? raw.placeId);
    if (isRealGoogleId(existingId) && raw.lat != null && raw.lng != null) {
      if (seenIds.has(existingId)) continue;
      const coreOk = isResolvedCorePlace({
        id: existingId,
        googlePlaceId: existingId,
        name,
        address: raw.address ?? `${name}, ${params.destination}`,
        lat: raw.lat,
        lng: raw.lng,
        destinationMatch: true,
      });
      if (!coreOk) {
        needsMapping.push(raw);
        continue;
      }

      if (params.fetchPlaceDetails && !raw.photoName) {
        const detailed = await enrichWithDetails(
          {
            id: existingId,
            name,
            address: raw.address ?? `${name}, ${params.destination}`,
            lat: raw.lat,
            lng: raw.lng,
            rating: raw.rating ?? null,
            userRatingCount: raw.userRatingCount ?? null,
            photoName: raw.photoName ?? null,
            primaryType: null,
            types: null,
            businessStatus: null,
            openStatus: "unknown",
            openStatusLabel: "",
            todayHoursLabel: "",
            closingSoonNote: "",
            nextOpenHint: "",
          },
          params.fetchPlaceDetails,
          generationRequestId,
        );
        if (detailed.enriched && isResolvedGooglePlace(detailed.place)) {
          seenIds.add(existingId);
          ready.push(
            placeToChatItem(detailed.place, params.context, params.locale, {
              sourceCombinationId: raw.sourceCombinationId,
              sourceCombinationIds: raw.sourceCombinationIds,
              matchedCombinationIds: raw.matchedCombinationIds,
              matchedSelectedCombinationIds: raw.matchedSelectedCombinationIds,
            }),
          );
          continue;
        }
      }
      seenIds.add(existingId);
      ready.push({
        ...raw,
        placeId: existingId,
        googlePlaceId: existingId,
        address: raw.address ?? `${name}, ${params.destination}`,
      });
      continue;
    }

    needsMapping.push(raw);
  }

  const mapped = await mapWithConcurrencyLimit(
    needsMapping,
    async (raw) => {
      const name = (raw.placeName ?? raw.name ?? "").trim();
      if (!name) return null;
      const found = await mapNamedPlaceToGoogle({
        name,
        destination: params.destination,
        lat: params.lat,
        lng: params.lng,
        locale: params.locale,
        searchPlaces: params.searchPlaces,
        fetchPlaceDetails: params.fetchPlaceDetails,
        dedupe,
        generationRequestId,
      });
      if (!found) return null;
      return { found, raw };
    },
    { concurrency: PLACE_MAP_MAX_CONCURRENCY },
  );

  for (const row of mapped) {
    if (!row?.found || !isResolvedCorePlace({ ...row.found, destinationMatch: true })) {
      continue;
    }
    const id = normalizeGooglePlaceId(row.found.id);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    ready.push(
      placeToChatItem(row.found, params.context, params.locale, {
        sourceCombinationId: row.raw.sourceCombinationId,
        sourceCombinationIds: row.raw.sourceCombinationIds,
        matchedCombinationIds: row.raw.matchedCombinationIds,
        matchedSelectedCombinationIds: row.raw.matchedSelectedCombinationIds,
      }),
    );
  }

  return ready;
}

export { isRealGoogleId as isMappableGooglePlaceId, isResolvedCorePlace };
