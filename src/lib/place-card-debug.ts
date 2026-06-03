import type { HomeNearbyPick } from "@/lib/explore-category-search";
import {
  resolveHomeNearbyHoursDisplay,
  resolveHomeNearbyImageSource,
} from "@/lib/home-nearby-card-display";
import type { PlaceResult } from "@/lib/place-result";
import {
  derivePlaceAvailability,
  inferOpeningHoursSourceField,
  type OpeningHoursSourceField,
  type PlaceHoursData,
} from "@/lib/filter-available-places";
import { resolvePlaceCardOpeningDisplay } from "@/lib/place-card-opening";

export type PlaceCardImageSource = "google" | "unsplash" | "fallback";

export function resolvePlaceCardImageSource(
  place: Pick<PlaceResult, "photoName" | "coverImageUrl">,
  runtimeSource?: string | null,
): PlaceCardImageSource {
  if (
    runtimeSource === "google-photo" ||
    runtimeSource === "proxy-photo" ||
    runtimeSource === "google"
  ) {
    return "google";
  }
  if (runtimeSource === "unsplash") return "unsplash";
  if (place.photoName?.trim()) return "google";
  if (
    place.coverImageUrl?.trim() &&
    (place.coverImageUrl.includes("place-photo") ||
      place.coverImageUrl.includes("googleusercontent") ||
      place.coverImageUrl.includes("maps.googleapis"))
  ) {
    return "google";
  }
  return "fallback";
}

export function logPlacePhotoSource(
  place: Pick<PlaceResult, "name" | "photoName" | "coverImageUrl">,
  runtimeSource?: string | null,
): void {
  const source = resolvePlaceCardImageSource(place, runtimeSource);
  console.info("[PLACE_PHOTO_SOURCE]", {
    placeName: place.name,
    source,
    photoReference: place.photoName?.trim() || null,
  });
}

export function logPlaceOpeningHours(
  place: Pick<
    PlaceResult,
    | "name"
    | "openStatus"
    | "openStatusLabel"
    | "todayHoursLabel"
    | "closesAtLabel"
    | "photoName"
    | "businessStatus"
  >,
  hoursData?: PlaceHoursData | null,
): void {
  const display = resolvePlaceCardOpeningDisplay(place);
  let sourceField: OpeningHoursSourceField = "none";
  if (hoursData) {
    const availability = derivePlaceAvailability(hoursData, { context: "lenient" });
    sourceField = availability.hoursSourceField;
  } else {
    sourceField = inferOpeningHoursSourceField(
      {
        businessStatus: place.businessStatus ?? null,
        currentOpeningHours: null,
        regularOpeningHours: null,
      },
      {
        businessStatus: place.businessStatus ?? null,
        openStatus: place.openStatus,
        displayStatus: place.openStatusLabel ?? "",
        todayHoursLabel: place.todayHoursLabel ?? "",
        closesAtLabel: place.closesAtLabel ?? "",
        closingSoonNote: "",
        nextOpenHint: "",
        sortWeight: 0,
        isRecommendable: true,
        hoursSourceField: "none",
      },
    );
    if (place.openStatus !== "unknown") {
      sourceField = "currentOpeningHours.openNow";
    } else if (place.todayHoursLabel?.startsWith("今日")) {
      sourceField = "regularOpeningHours.weekdayDescriptions";
    }
  }

  const closingTime =
    place.closesAtLabel?.replace(/^營業至\s*/, "").trim() ||
    (display.hoursLabel.startsWith("營業至")
      ? display.hoursLabel.replace(/^營業至\s*/, "").trim()
      : null);

  console.info("[PLACE_OPENING_HOURS]", {
    placeName: place.name,
    openNow: display.openNow,
    closingTime,
    sourceField,
  });
}

export function logPlaceCardSource(
  place: Pick<
    PlaceResult,
    "id" | "name" | "photoName" | "openStatus" | "businessStatus" | "coverImageUrl"
  > & { photoCount?: number },
  runtimeImageSource?: string | null,
): void {
  logPlacePhotoSource(place, runtimeImageSource);
  logPlaceOpeningHours(place);
}

export function logPlacePhotoUsed(name: string, placeId: string, urlKind: string): void {
  console.info("[PLACE_PHOTO_USED]", { name, placeId, urlKind });
}

export function logPlacePhotoFallback(name: string, placeId: string, reason: string): void {
  console.info("[PLACE_PHOTO_FALLBACK]", { name, placeId, reason });
}

export function logPlaceHoursResolved(
  place: Pick<PlaceResult, "id" | "name" | "openStatus" | "businessStatus">,
): void {
  console.info("[PLACE_HOURS_RESOLVED]", {
    placeId: place.id,
    name: place.name,
    openStatus: place.openStatus,
    businessStatus: place.businessStatus,
  });
  logPlaceOpeningHours(place);
}

export function logHomeNearbyPickDiagnostics(pick: HomeNearbyPick, imageSource?: string | null): void {
  logPlacePhotoSource(pick, imageSource);
  logPlaceOpeningHours(pick);
}

/** 首頁附近卡片 render 前：確認進入 UI 的實際欄位 */
export function logHomeNearbyCardData(
  pick: HomeNearbyPick,
  imageSource?: string | null,
): void {
  const hours = pick.hoursData;
  const resolvedImage = resolveHomeNearbyImageSource(pick, imageSource);
  const hoursDisplay = resolveHomeNearbyHoursDisplay(pick);
  console.info("[HOME_NEARBY_CARD_DATA]", {
    name: pick.name,
    photoName: pick.photoName ?? null,
    photos: pick.photoNames ?? [],
    coverImageUrl: pick.coverImageUrl ? pick.coverImageUrl.slice(0, 120) : null,
    imageSource: resolvedImage,
    openStatusLabel: pick.openStatusLabel ?? null,
    todayHoursLabel: pick.todayHoursLabel ?? null,
    closesAtLabel: pick.closesAtLabel ?? null,
    displayStatusLabel: hoursDisplay.statusLabel || null,
    displayHoursLabel: hoursDisplay.hoursLabel,
    currentOpeningHours: hours?.currentOpeningHours ?? null,
    regularOpeningHours: hours?.regularOpeningHours ?? null,
    openingHours: hours ?? null,
    openStatus: pick.openStatus,
    businessStatus: pick.businessStatus ?? null,
  });
  logPlacePhotoSource(pick, imageSource);
  logPlaceOpeningHours(pick, hours);
}

export function logHomeNearbyCardsData(places: HomeNearbyPick[]): void {
  if (!places.length) return;
  console.info("[HOME_NEARBY_CARDS_RENDER]", { count: places.length });
  for (const pick of places) {
    logHomeNearbyCardData(pick);
  }
}
