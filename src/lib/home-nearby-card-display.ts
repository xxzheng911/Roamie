import type { HomeNearbyPick } from "@/lib/explore-category-search";
import type { PlaceHoursData } from "@/lib/filter-available-places";
import {
  applyAvailabilityFields,
  derivePlaceAvailability,
} from "@/lib/filter-available-places";
import { resolvePlaceCardOpeningDisplay } from "@/lib/place-card-opening";
import type { PlaceResult } from "@/lib/place-result";

export type HomeNearbyCardImageSource = "google" | "maps_proxy_or_unsplash" | "fallback";

/** Google photoName / photos 優先於 coverImageUrl */
export function resolveHomeNearbyImageSource(
  pick: Pick<HomeNearbyPick, "photoName" | "photoNames" | "coverImageUrl">,
  runtimeSource?: string | null,
): HomeNearbyCardImageSource {
  if (
    runtimeSource === "google-photo" ||
    runtimeSource === "proxy-photo" ||
    runtimeSource === "google"
  ) {
    return "google";
  }
  const photoName = pick.photoName?.trim();
  const photoNames = pick.photoNames?.filter((n) => n?.trim()) ?? [];
  if (photoName || photoNames.length > 0) return "google";
  const cover = pick.coverImageUrl?.trim();
  if (cover) {
    if (
      cover.includes("place-photo") ||
      cover.includes("googleusercontent") ||
      cover.includes("maps.googleapis")
    ) {
      return "google";
    }
    return "maps_proxy_or_unsplash";
  }
  return "fallback";
}

export function pickPrimaryPhotoName(pick: HomeNearbyPick): string | null {
  const fromList = pick.photoNames?.find((n) => n?.trim())?.trim();
  return pick.photoName?.trim() || fromList || null;
}

/** 以 lenient 重新映射 Details 回傳的原始 hours（避免「現在打烊」卻無今日時段） */
export function remapPlaceResultWithLenientHours(
  place: PlaceResult,
  hoursData?: PlaceHoursData | null,
): PlaceResult {
  if (!hoursData) return place;
  const availability = derivePlaceAvailability(hoursData, { context: "lenient" });
  const fields = applyAvailabilityFields({}, availability);
  return {
    ...place,
    businessStatus: availability.businessStatus,
    openStatus: availability.openStatus,
    openStatusLabel: fields.openStatusLabel,
    todayHoursLabel: fields.todayHoursLabel,
    closesAtLabel: fields.closesAtLabel,
    closingSoonNote: fields.closingSoonNote,
    nextOpenHint: fields.nextOpenHint,
  };
}

export function homeNearbyPickHasHoursData(
  pick: Pick<
    HomeNearbyPick,
    | "hoursData"
    | "openStatus"
    | "openStatusLabel"
    | "todayHoursLabel"
    | "closesAtLabel"
    | "businessStatus"
  >,
): boolean {
  const hours = pick.hoursData;
  if (hours) {
    return Boolean(
      hours.currentOpeningHours?.openNow !== undefined ||
        hours.currentOpeningHours?.weekdayDescriptions?.length ||
        hours.regularOpeningHours?.weekdayDescriptions?.length ||
        hours.regularOpeningHours?.periods?.length ||
        hours.businessStatus,
    );
  }
  return (
    pick.openStatus !== "unknown" ||
    Boolean(pick.openStatusLabel?.trim()) ||
    Boolean(pick.todayHoursLabel?.trim()) ||
    Boolean(pick.closesAtLabel?.trim())
  );
}

/** 首頁附近卡片營業時間顯示（有 hours 資料時不得用「暫時無法確認」） */
export function resolveHomeNearbyHoursDisplay(pick: HomeNearbyPick): {
  statusLabel: string;
  hoursLabel: string;
} {
  const opening = resolvePlaceCardOpeningDisplay({
    id: pick.id,
    name: pick.name,
    openStatus: pick.openStatus,
    openStatusLabel: pick.openStatusLabel,
    todayHoursLabel: pick.todayHoursLabel,
    closesAtLabel: pick.closesAtLabel,
    closingSoonNote: pick.closingSoonNote,
    nextOpenHint: pick.nextOpenHint,
    businessStatus: pick.businessStatus,
  });

  const hasHours = homeNearbyPickHasHoursData(pick);
  const genericUnknown = "暫時無法確認營業時間";

  if (opening.hoursLabel === genericUnknown && hasHours) {
    if (pick.openStatus === "closed_now" || /打烊|休息|closed/i.test(pick.openStatusLabel ?? "")) {
      return { statusLabel: "已打烊", hoursLabel: pick.nextOpenHint?.trim() || pick.todayHoursLabel?.trim() || "營業時間待確認" };
    }
    if (pick.openStatus === "open" || pick.openStatus === "closing_soon") {
      return {
        statusLabel: opening.statusLabel || "營業中",
        hoursLabel: pick.closesAtLabel?.trim() || pick.todayHoursLabel?.trim() || "營業時間待確認",
      };
    }
    if (pick.todayHoursLabel?.trim()) {
      return { statusLabel: "", hoursLabel: pick.todayHoursLabel.trim() };
    }
    if ((pick.businessStatus ?? "").toUpperCase() === "OPERATIONAL") {
      return { statusLabel: "", hoursLabel: "營業時間待確認" };
    }
    return { statusLabel: "", hoursLabel: "營業時間待確認" };
  }

  if (opening.hoursLabel === genericUnknown) {
    return { statusLabel: "", hoursLabel: genericUnknown };
  }

  return {
    statusLabel: opening.statusLabel,
    hoursLabel: opening.hoursLabel,
  };
}
