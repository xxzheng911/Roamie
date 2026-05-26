import type { HomeNearbyPick } from "@/lib/explore-category-search";

const HANDOFF_KEY = "roamie:map-explore-handoff";

export type MapExploreHandoff = {
  categoryId: string;
  placeId: string;
  /** 首頁點擊時帶完整地點，避免地圖重搜後對不到同一筆 */
  placeSnapshot?: HomeNearbyPick;
};

export function setMapExploreHandoff(handoff: MapExploreHandoff): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  } catch (e) {
    console.warn("[Roamie] setMapExploreHandoff failed", e);
  }
}

export function consumeMapExploreHandoff(): MapExploreHandoff | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(HANDOFF_KEY);
    const parsed = JSON.parse(raw) as MapExploreHandoff;
    if (parsed?.categoryId && (parsed.placeId || parsed.placeSnapshot)) return parsed;
    return null;
  } catch {
    return null;
  }
}
