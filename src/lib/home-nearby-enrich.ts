import type { HomeNearbyPick } from "@/lib/explore-category-search";

/** 快取版本：欄位／enrichment 邏輯變更時遞增，避免舊快取略過 Place Details */
export const HOME_NEARBY_CACHE_VERSION = "v5";

function pickHasUsableHours(pick: HomeNearbyPick): boolean {
  if (pick.hoursData) {
    const h = pick.hoursData;
    return Boolean(
      h.currentOpeningHours?.openNow !== undefined ||
        h.currentOpeningHours?.weekdayDescriptions?.length ||
        h.regularOpeningHours?.weekdayDescriptions?.length ||
        h.regularOpeningHours?.periods?.length,
    );
  }
  return (
    pick.openStatus !== "unknown" ||
    Boolean(pick.todayHoursLabel?.trim()) ||
    Boolean(pick.openStatusLabel?.trim()) ||
    Boolean(pick.closesAtLabel?.trim())
  );
}

export function homeNearbyPickNeedsEnrichment(pick: HomeNearbyPick): boolean {
  if (
    pick.id.startsWith("mock-") ||
    pick.id.startsWith("saved-") ||
    pick.id.startsWith("temp:")
  ) {
    return false;
  }
  const hasPhoto = Boolean(pick.photoName?.trim() || (pick.photoNames?.length ?? 0) > 0);
  if (hasPhoto && pickHasUsableHours(pick)) return false;
  return true;
}

export function homeNearbyPicksNeedEnrichment(picks: HomeNearbyPick[]): boolean {
  return picks.some(homeNearbyPickNeedsEnrichment);
}
