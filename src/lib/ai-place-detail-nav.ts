import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { Locale } from "@/lib/i18n/types";
import {
  extractGooglePlaceIdFromMapsUrl,
  isRoutableGooglePlaceId,
  latLngFallbackPlaceId,
  setPlaceDetailHandoff,
  type PlaceDetailHandoff,
} from "@/lib/place-detail-handoff";
import {
  createTemporaryPlaceId,
  setPlaceDetailStoreEntry,
} from "@/lib/place-detail-store";
import { searchPlaces } from "@/services/placesService";
import type { TripStopSuggestion } from "@/lib/trip-stop-search.functions";

export function recommendationToPlaceHandoff(
  rec: RoamieRecommendationItem,
  placeId: string,
): PlaceDetailHandoff {
  const ext = rec as RoamieRecommendationItem & {
    photoName?: string | null;
    rating?: number | null;
  };
  return {
    placeId,
    name: rec.placeName ?? rec.name,
    address: rec.address?.trim() || null,
    lat: rec.lat ?? null,
    lng: rec.lng ?? null,
    photoName: ext.photoName ?? null,
    rating: ext.rating ?? null,
    category: rec.type ?? null,
    reason: rec.reason,
  };
}

function pickBestSuggestion(
  suggestions: TripStopSuggestion[],
  targetName: string,
  address?: string | null,
): TripStopSuggestion | null {
  if (!suggestions.length) return null;
  const norm = (s: string) => s.trim().toLowerCase();
  const nameKey = norm(targetName);
  const addrKey = address?.trim() ? norm(address) : "";
  const exact = suggestions.find(
    (s) => norm(s.label) === nameKey || (addrKey && norm(s.secondary).includes(addrKey)),
  );
  return exact ?? suggestions[0] ?? null;
}

function normalizeGooglePlaceId(raw: string): string {
  return raw.replace(/^places\//, "").trim();
}

function googlePlaceIdFromRecommendation(rec: RoamieRecommendationItem): string | null {
  const fromField = rec.googlePlaceId?.trim() ?? "";
  if (fromField) {
    const normalized = normalizeGooglePlaceId(fromField);
    if (isRoutableGooglePlaceId(normalized)) return normalized;
  }
  const fromUrl = extractGooglePlaceIdFromMapsUrl(rec.googleMapsUrl ?? "");
  return fromUrl;
}

/** 從 AI 推薦卡解析可導航的 placeId，必要時搜尋或建立 temp id */
export async function resolvePlaceIdForRecommendation(
  rec: RoamieRecommendationItem,
  locale: Locale,
): Promise<{ placeId: string; handoff: PlaceDetailHandoff }> {
  const googleId = googlePlaceIdFromRecommendation(rec);
  if (googleId) {
    const handoff = recommendationToPlaceHandoff(rec, googleId);
    return { placeId: googleId, handoff };
  }

  const name = (rec.placeName ?? rec.name).trim();
  const query = [name, rec.address?.trim()].filter(Boolean).join(" ");
  if (query.length >= 2) {
    const { suggestions, error } = await searchPlaces(query, { locale });
    if (error) console.info("[AI_PLACE_CARD] search error=", error);
    const match = pickBestSuggestion(suggestions, name, rec.address);
    if (match?.placeId?.trim()) {
      const placeId = normalizeGooglePlaceId(match.placeId.trim());
      if (isRoutableGooglePlaceId(placeId)) {
        const handoff = recommendationToPlaceHandoff(rec, placeId);
        if (match.secondary) handoff.address = match.secondary;
        if (match.lat != null && match.lng != null) {
          handoff.lat = match.lat;
          handoff.lng = match.lng;
        }
        return { placeId, handoff };
      }
    }
  }

  if (rec.lat != null && rec.lng != null && Number.isFinite(rec.lat) && Number.isFinite(rec.lng)) {
    const placeId = latLngFallbackPlaceId(rec.lat, rec.lng);
    return { placeId, handoff: recommendationToPlaceHandoff(rec, placeId) };
  }

  const placeId = createTemporaryPlaceId();
  const handoff = recommendationToPlaceHandoff(rec, placeId);
  return { placeId, handoff };
}

export type PlaceDetailNavigateArgs = {
  rec: RoamieRecommendationItem;
  locale: Locale;
  navigate: (opts: {
    to: "/place/$placeId";
    params: { placeId: string };
    search?: { from?: string };
    replace?: boolean;
  }) => Promise<void>;
  onBeforeNavigate?: () => void;
  from?: string;
};

export async function navigateToPlaceDetailFromRecommendation({
  rec,
  locale,
  navigate,
  onBeforeNavigate,
  from = "chat",
}: PlaceDetailNavigateArgs): Promise<boolean> {
  const rawPlace = {
    name: rec.placeName ?? rec.name,
    googlePlaceId: rec.googlePlaceId ?? null,
    googleMapsUrl: rec.googleMapsUrl ?? null,
    address: rec.address ?? null,
    lat: rec.lat,
    lng: rec.lng,
  };
  console.info("[AI_PLACE_CARD] clicked");
  console.info("[AI_PLACE_CARD] rawPlace=", JSON.stringify(rawPlace));

  try {
    const { placeId, handoff } = await resolvePlaceIdForRecommendation(rec, locale);
    if (!placeId?.trim()) {
      console.info("[AI_PLACE_CARD] placeId= (empty, abort)");
      return false;
    }

    const routePlaceId = encodeURIComponent(placeId);
    const route = `/place/${routePlaceId}`;
    console.info("[AI_PLACE_CARD] placeId=", placeId);
    console.info("[AI_PLACE_CARD] route=", route);

    setPlaceDetailHandoff(handoff);
    setPlaceDetailStoreEntry(placeId, handoff);
    onBeforeNavigate?.();

    console.info("[PLACE_ROUTE] push start");
    await navigate({
      to: "/place/$placeId",
      params: { placeId },
      search: { from },
      replace: false,
    });
    console.info("[PLACE_ROUTE] push success");
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[PLACE_ROUTE] push error=", msg);
    return false;
  }
}
