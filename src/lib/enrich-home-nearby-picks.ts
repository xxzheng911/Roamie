import type { PlaceDetailsFetchFn } from "@/lib/place-details-unified";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { buildUnifiedPlaceCard } from "@/lib/unified-place-card";
import type { Locale } from "@/lib/i18n/types";
import { logPlaceCardSource, logPlaceHoursResolved } from "@/lib/place-card-debug";
import { remapPlaceResultWithLenientHours } from "@/lib/home-nearby-card-display";
import {
  logNearbyPlaceNormalizeSkipped,
  logNearbyPlacesReady,
  sanitizeHomeNearbyPick,
  sanitizeHomeNearbyPicks,
} from "@/lib/nearby-place-normalize";
import type { PlaceResult } from "@/lib/place-result";
import {
  homeNearbyPickNeedsEnrichment,
  homeNearbyPicksNeedEnrichment,
} from "@/lib/home-nearby-enrich";

const ENRICH_CONCURRENCY = 4;

export { homeNearbyPickNeedsEnrichment, homeNearbyPicksNeedEnrichment };

function detailsToPlaceResult(
  pick: HomeNearbyPick,
  details: NonNullable<Awaited<ReturnType<PlaceDetailsFetchFn>>["place"]>,
): PlaceResult {
  const base: PlaceResult = {
    id: pick.id,
    name: details.name || pick.name,
    address: details.address ?? pick.address,
    lat: details.lat ?? pick.lat,
    lng: details.lng ?? pick.lng,
    rating: details.rating ?? pick.rating,
    userRatingCount: details.userRatingCount ?? pick.userRatingCount,
    photoName: details.photoName ?? pick.photoName,
    primaryType: details.primaryType ?? pick.primaryType,
    types: details.types ?? pick.types,
    businessStatus: details.businessStatus ?? pick.businessStatus,
    openStatus: details.openStatus,
    openStatusLabel: details.openStatusLabel,
    todayHoursLabel: details.todayHoursLabel,
    closesAtLabel: details.closesAtLabel,
    closingSoonNote: details.closingSoonNote,
    nextOpenHint: details.nextOpenHint,
  };
  return remapPlaceResultWithLenientHours(base, details.hoursData);
}

function mergePickWithDetails(
  pick: HomeNearbyPick,
  details: NonNullable<Awaited<ReturnType<PlaceDetailsFetchFn>>["place"]>,
): HomeNearbyPick | null {
  if (details.openStatus === "permanently_closed") {
    console.info("[PLACE_DETAILS_FETCHED]", {
      placeId: pick.id,
      name: pick.name,
      filtered: "CLOSED_PERMANENTLY",
    });
    return null;
  }

  try {
    const place = detailsToPlaceResult(pick, details);
    const card = buildUnifiedPlaceCard({
      place,
      reason: pick.reason,
      categoryId: pick.categoryId,
      isSavedFavorite: pick.isSavedFavorite,
    });

    console.info("[PLACE_DETAILS_FETCHED]", {
      placeId: pick.id,
      name: pick.name,
      hasPhoto: Boolean(place.photoName),
      openStatus: place.openStatus,
    });
    logPlaceHoursResolved(place);

    const primaryPhoto =
      place.photoName?.trim() ||
      details.photoNames?.find((n) => n?.trim())?.trim() ||
      null;
    const merged: HomeNearbyPick = {
      ...card,
      reason: pick.reason,
      categoryId: pick.categoryId,
      isSavedFavorite: pick.isSavedFavorite,
      distanceLabel: pick.distanceLabel,
      photoName: primaryPhoto,
      photoNames: details.photoNames?.length ? details.photoNames : pick.photoNames,
      hoursData: details.hoursData ?? pick.hoursData,
      /** 有 Google photo 時不得保留 cover，避免 Unsplash／fallback 搶先顯示 */
      coverImageUrl: primaryPhoto ? null : (card.coverImageUrl ?? pick.coverImageUrl ?? null),
    };
    return sanitizeHomeNearbyPick(merged);
  } catch (e) {
    logNearbyPlaceNormalizeSkipped(
      e instanceof Error ? e.message : "merge_details_failed",
      { pickId: pick.id, detailsId: details.id },
    );
    return sanitizeHomeNearbyPick(pick);
  }
}

async function enrichOnePick(
  pick: HomeNearbyPick,
  fetchDetails: PlaceDetailsFetchFn,
  locale: Locale,
): Promise<HomeNearbyPick | null> {
  console.info("[PLACE_DETAILS_ENRICH_START]", {
    placeId: pick.id,
    placeName: pick.name,
    hadPhotoName: Boolean(pick.photoName?.trim()),
    openStatus: pick.openStatus,
  });
  try {
    const { place, error } = await fetchDetails({
      data: { placeId: pick.id, locale },
    });
    if (!place) {
      console.info("[PLACE_DETAILS_ENRICH_FAILED]", {
        placeId: pick.id,
        placeName: pick.name,
        error: error ?? "no_place",
      });
      logPlaceCardSource(pick);
      return sanitizeHomeNearbyPick(pick);
    }
    const merged = mergePickWithDetails(pick, place);
    console.info("[PLACE_DETAILS_ENRICH_SUCCESS]", {
      placeId: pick.id,
      placeName: pick.name,
      photoName: merged?.photoName ?? null,
      openStatus: merged?.openStatus,
      openStatusLabel: merged?.openStatusLabel ?? null,
      todayHoursLabel: merged?.todayHoursLabel ?? null,
    });
    return merged;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[PLACE_DETAILS_ENRICH_FAILED]", {
      placeId: pick.id,
      placeName: pick.name,
      error: msg,
    });
    logPlaceCardSource(pick);
    return sanitizeHomeNearbyPick(pick);
  }
}

/** 首頁附近卡片：營業時間／照片不足時以 Place Details 補齊；整批失敗時回傳 sanitize 後的原始列表 */
export async function enrichHomeNearbyPicks(
  picks: HomeNearbyPick[],
  fetchDetails: PlaceDetailsFetchFn,
  locale: Locale,
): Promise<HomeNearbyPick[]> {
  const baseline = sanitizeHomeNearbyPicks(picks);
  if (!baseline.length) return [];

  try {
    const targets = baseline.filter(homeNearbyPickNeedsEnrichment);
    console.info("[PLACE_DETAILS_ENRICH_BATCH]", {
      total: baseline.length,
      targets: targets.length,
    });
    const enrichedById = new Map<string, HomeNearbyPick | null>();

    if (targets.length) {
      let index = 0;
      async function worker(): Promise<void> {
        while (index < targets.length) {
          const i = index++;
          const pick = targets[i]!;
          enrichedById.set(pick.id, await enrichOnePick(pick, fetchDetails, locale));
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(ENRICH_CONCURRENCY, targets.length) }, () => worker()),
      );
    }

    const out: HomeNearbyPick[] = [];
    for (const pick of baseline) {
      const merged = enrichedById.get(pick.id);
      if (merged === null) continue;
      const next = merged ?? pick;
      logPlaceCardSource(next);
      out.push(next);
    }

    logNearbyPlacesReady(out.length);
    return out.length > 0 ? out : baseline;
  } catch (e) {
    console.warn("[Roamie Home] enrichHomeNearbyPicks failed", e);
    logNearbyPlacesReady(baseline.length);
    return baseline;
  }
}
