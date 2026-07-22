/**
 * Recommendation → Planner Candidate Pool handoff.
 *
 * Chat-resolved PlaceResults must seed Layer-2 + session pool so Planner /
 * Combination / itinerary mapping reuse them with 0 new Places calls.
 */
import type { PlaceResult } from "@/lib/place-result";
import { dedupeCandidatePlaces } from "@/lib/ai/ai-multi-day-planner";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import {
  readCandidatePoolCache,
  writeCandidatePoolCache,
} from "@/lib/ai/places-cost-cache/candidate-pool-cache";
import {
  bindSessionCandidatePool,
  ensureSessionDestination,
  readSessionCandidatePool,
} from "@/lib/ai/places-cost-cache/session-pool";
import { logCandidatePoolIngest } from "@/lib/ai/places-cost-cache/log";

function isIngestiblePlace(place: PlaceResult): boolean {
  if (!place?.name?.trim()) return false;
  if (place.lat == null || place.lng == null) return false;
  return isHardGooglePlaceId(place.id);
}

/**
 * Merge already-fetched recommendation places into the shared Candidate Pool.
 * Never triggers Places Search.
 */
export function ingestResolvedPlacesIntoCandidatePool(params: {
  sessionId?: string | null;
  destination: string;
  countryCode?: string;
  places: PlaceResult[];
  source?: string;
}): { places: PlaceResult[]; added: number; total: number } {
  const destination = normalizeDestinationLabel(params.destination);
  const source = params.source ?? "chat_recommendation";
  const incoming = (params.places ?? []).filter(isIngestiblePlace);
  if (!destination || !incoming.length) {
    return { places: [], added: 0, total: 0 };
  }

  const sessionId = (params.sessionId ?? "chat_default").trim() || "chat_default";
  ensureSessionDestination(sessionId, destination);

  const sessionPool = readSessionCandidatePool({ sessionId, destination });
  const layer2 = readCandidatePoolCache(destination, params.countryCode);
  const prior = dedupeCandidatePlaces([
    ...(sessionPool?.places ?? []),
    ...(layer2?.places ?? []),
  ]);
  const priorIds = new Set(prior.map((p) => p.id));
  const addedPlaces = incoming.filter((p) => !priorIds.has(p.id));
  const merged = dedupeCandidatePlaces([...prior, ...incoming]);

  writeCandidatePoolCache({
    destination,
    countryCode: params.countryCode ?? layer2?.countryCode,
    places: merged,
    poolResult: layer2?.poolResult ?? sessionPool?.poolResult,
    searchRequestCount: layer2?.searchRequestCount ?? 0,
  });
  bindSessionCandidatePool({
    sessionId,
    destination,
    places: merged,
    poolResult: layer2?.poolResult ?? sessionPool?.poolResult,
  });

  logCandidatePoolIngest({
    source,
    destination,
    sessionId,
    added: addedPlaces.length,
    total: merged.length,
  });

  return {
    places: merged,
    added: addedPlaces.length,
    total: merged.length,
  };
}

/** Resolve a named candidate from Layer-2 / session pool (0 Places). */
export function matchNamedPlaceFromCandidatePool(params: {
  name: string;
  destination: string;
  sessionId?: string | null;
  countryCode?: string;
}): PlaceResult | null {
  const destination = normalizeDestinationLabel(params.destination);
  const name = params.name.trim();
  if (!destination || !name) return null;

  const sessionId = params.sessionId?.trim();
  const pools: PlaceResult[] = [];
  if (sessionId) {
    const sessionPool = readSessionCandidatePool({ sessionId, destination });
    if (sessionPool?.places.length) pools.push(...sessionPool.places);
  }
  const layer2 = readCandidatePoolCache(destination, params.countryCode);
  if (layer2?.places.length) pools.push(...layer2.places);
  if (!pools.length) return null;

  const target = normalizePlaceName(name);
  if (!target) return null;

  const exact = pools.find((p) => normalizePlaceName(p.name) === target);
  if (exact && isIngestiblePlace(exact)) return exact;

  if (target.length < 2) return null;
  const soft = pools.find((p) => {
    const n = normalizePlaceName(p.name);
    return n.includes(target) || target.includes(n);
  });
  return soft && isIngestiblePlace(soft) ? soft : null;
}

/** Convert chat recommendation cards into PlaceResult for pool ingest. */
export function chatPlaceItemToPlaceResult(item: {
  name?: string | null;
  placeName?: string | null;
  googlePlaceId?: string | null;
  placeId?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  rating?: number | null;
  userRatingCount?: number | null;
  photoName?: string | null;
  types?: string[] | null;
  type?: string | null;
  businessStatus?: string | null;
  openStatusLabel?: string | null;
  todayHoursLabel?: string | null;
}): PlaceResult | null {
  const id = (item.googlePlaceId ?? item.placeId ?? "").trim();
  const name = (item.placeName ?? item.name ?? "").trim();
  if (!name || !isHardGooglePlaceId(id) || item.lat == null || item.lng == null) {
    return null;
  }
  return {
    id,
    name,
    address: item.address ?? null,
    lat: item.lat,
    lng: item.lng,
    rating: item.rating ?? null,
    userRatingCount: item.userRatingCount ?? null,
    photoName: item.photoName ?? null,
    primaryType: item.types?.[0] ?? item.type ?? null,
    types: item.types ?? (item.type ? [item.type] : null),
    businessStatus: item.businessStatus ?? null,
    openStatus: "unknown",
    openStatusLabel: item.openStatusLabel ?? "",
    todayHoursLabel: item.todayHoursLabel ?? "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}
