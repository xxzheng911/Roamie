import type { HomeNearbyPick } from "@/lib/explore-category-search";
import type { PlaceResult } from "@/lib/place-result";

export function logNearbyRawPlacesReceived(count: number): void {
  console.info("[NEARBY_RAW_PLACES_RECEIVED]", { count });
}

export function logNearbyPlaceNormalized(place: {
  name: string;
  hasPhoto: boolean;
  businessStatus: string | null;
  openNow: boolean | null;
}): void {
  console.info("[NEARBY_PLACE_NORMALIZED]", place);
}

export function logNearbyPlaceNormalizeSkipped(
  reason: string,
  rawPlace: unknown,
): void {
  console.warn("[NEARBY_PLACE_NORMALIZE_SKIPPED]", {
    reason,
    rawPlace:
      rawPlace && typeof rawPlace === "object"
        ? JSON.stringify(rawPlace).slice(0, 400)
        : String(rawPlace ?? "").slice(0, 200),
  });
}

export function logNearbyPlacesReady(count: number): void {
  console.info("[NEARBY_PLACES_READY]", { count });
}

export function logNearbyPlacesRendered(count: number): void {
  console.info("[NEARBY_PLACES_RENDERED]", { count });
}

function openNowFromPick(pick: HomeNearbyPick): boolean | null {
  if (pick.openStatus === "open" || pick.openStatus === "closing_soon") return true;
  if (pick.openStatus === "closed_now" || pick.openStatus === "temporarily_closed") {
    return false;
  }
  return null;
}

/** 單筆地點：補齊必填欄位，不因缺圖／缺營業時間而丟棄 */
export function sanitizeHomeNearbyPick(pick: HomeNearbyPick): HomeNearbyPick | null {
  try {
    const id = (pick.id ?? "").trim();
    if (!id) {
      logNearbyPlaceNormalizeSkipped("missing_id", pick);
      return null;
    }

    const name = (pick.name ?? "").trim() || "附近地點";
    const photoName = pick.photoName?.trim() || null;
    const coverImageUrl = pick.coverImageUrl?.trim() || null;

    let openStatus = pick.openStatus ?? "unknown";
    let todayHoursLabel = pick.todayHoursLabel ?? "";
    let openStatusLabel = pick.openStatusLabel ?? "";

    if (/^待確認$/.test(todayHoursLabel.trim())) {
      todayHoursLabel = "";
    }

    const normalized: HomeNearbyPick = {
      ...pick,
      id,
      name,
      address: pick.address ?? null,
      lat: pick.lat ?? null,
      lng: pick.lng ?? null,
      rating: pick.rating ?? null,
      userRatingCount: pick.userRatingCount ?? null,
      photoName,
      photoNames: pick.photoNames,
      hoursData: pick.hoursData,
      coverImageUrl,
      primaryType: pick.primaryType ?? null,
      types: pick.types ?? null,
      businessStatus: pick.businessStatus ?? null,
      openStatus,
      openStatusLabel,
      todayHoursLabel,
      closesAtLabel: pick.closesAtLabel ?? "",
      closingSoonNote: pick.closingSoonNote ?? "",
      nextOpenHint: pick.nextOpenHint ?? "",
      reason: pick.reason?.trim() || pick.displayCategory || "適合現在去走走",
      categoryId: pick.categoryId ?? "all",
    };

    logNearbyPlaceNormalized({
      name: normalized.name,
      hasPhoto: Boolean(photoName || coverImageUrl),
      businessStatus: normalized.businessStatus,
      openNow: openNowFromPick(normalized),
    });

    return normalized;
  } catch (e) {
    logNearbyPlaceNormalizeSkipped(
      e instanceof Error ? e.message : "sanitize_failed",
      pick,
    );
    return null;
  }
}

export function sanitizeHomeNearbyPicks(picks: HomeNearbyPick[]): HomeNearbyPick[] {
  const out: HomeNearbyPick[] = [];
  for (const pick of picks.filter(Boolean)) {
    const normalized = sanitizeHomeNearbyPick(pick);
    if (normalized) out.push(normalized);
  }
  logNearbyPlacesReady(out.length);
  return out;
}

/** PlaceResult → 可顯示的 HomeNearbyPick（單筆失敗不影響整批） */
export function placeResultToNearbyPick(
  place: PlaceResult,
  extras?: Partial<HomeNearbyPick>,
): HomeNearbyPick | null {
  try {
    const base: HomeNearbyPick = {
      ...place,
      reason: extras?.reason ?? "",
      categoryId: extras?.categoryId ?? "all",
      displayCategory: extras?.displayCategory,
      coverImageUrl: extras?.coverImageUrl ?? null,
      distanceLabel: extras?.distanceLabel,
      isSavedFavorite: extras?.isSavedFavorite,
    };
    return sanitizeHomeNearbyPick(base);
  } catch (e) {
    logNearbyPlaceNormalizeSkipped(
      e instanceof Error ? e.message : "place_result_failed",
      place,
    );
    return null;
  }
}
