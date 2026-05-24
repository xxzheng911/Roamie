const HANDOFF_KEY = "roamie:map-explore-handoff";

export type MapExploreHandoff = {
  categoryId: string;
  placeId: string;
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
    if (parsed?.categoryId && parsed?.placeId) return parsed;
    return null;
  } catch {
    return null;
  }
}
