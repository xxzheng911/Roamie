import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { setMapExploreHandoff } from "@/lib/map-explore-handoff";

/** 依推薦類型對應探索地圖分類 tab */
function inferExploreCategoryId(type: string): string {
  const t = type.toLowerCase();
  if (/咖啡|coffee|cafe|茶/.test(t)) return "coffee";
  if (/景點|觀光|museum|attraction|藝廊|博物/.test(t)) return "sight";
  if (/商圈|夜市|購物|shopping|market|文創|伴手/.test(t)) return "district";
  if (/美食|餐|food|restaurant|小吃|bar|夜/.test(t)) return "food";
  if (/公園|park|自然|步道|海/.test(t)) return "park";
  return "all";
}

/** 將聊天／推薦頁的地點轉成地圖詳情 handoff（含完整 snapshot，避免重搜對不到） */
export function recommendationToPlaceSnapshot(rec: RoamieRecommendationItem): HomeNearbyPick {
  const name = rec.placeName?.trim() || rec.name.trim();
  const id = rec.googlePlaceId?.trim() || `rec-${encodeURIComponent(name)}`;
  const categoryId = inferExploreCategoryId(rec.type);
  const photoName = rec.photoName ?? null;

  return {
    id,
    name,
    address: rec.address?.trim() || null,
    lat: rec.lat,
    lng: rec.lng,
    rating: rec.rating ?? null,
    userRatingCount: rec.userRatingCount ?? null,
    photoName,
    primaryType: rec.type || null,
    types: rec.type ? [rec.type] : null,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: rec.openStatusLabel ?? "",
    todayHoursLabel: rec.todayHoursLabel ?? "",
    closingSoonNote: rec.closingSoonNote ?? "",
    nextOpenHint: rec.nextOpenHint ?? "",
    reason: rec.reason?.trim() || rec.description?.trim() || "",
    categoryId,
    displayCategory: rec.type,
    coverImageUrl: photoName ? (buildPlacePhotoUrl(photoName, 600) ?? undefined) : undefined,
  };
}

export function openRecommendationOnMap(rec: RoamieRecommendationItem): HomeNearbyPick {
  const snapshot = recommendationToPlaceSnapshot(rec);
  setMapExploreHandoff({
    categoryId: snapshot.categoryId,
    placeId: snapshot.id,
    placeSnapshot: snapshot,
  });
  return snapshot;
}
