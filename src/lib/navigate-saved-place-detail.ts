import type { SavedPlace } from "@/lib/places-storage";
import { resolveSavedPlaceImageUrl } from "@/lib/saved-places-image";
import {
  isRoutableGooglePlaceId,
  latLngFallbackPlaceId,
  setPlaceDetailHandoff,
  type PlaceDetailHandoff,
} from "@/lib/place-detail-handoff";
import { createTemporaryPlaceId, setPlaceDetailStoreEntry } from "@/lib/place-detail-store";
import type { Locale } from "@/lib/i18n/types";

function normalizeGooglePlaceId(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const id = raw.replace(/^places\//, "").trim();
  return isRoutableGooglePlaceId(id) ? id : null;
}

/** 收藏列表的 city 常為「附近」，不可拿去當搜尋關鍵字 */
function sanitizeSavedCity(city: string | null | undefined): string | null {
  const c = city?.trim();
  if (!c) return null;
  if (/^(附近|nearby)$/i.test(c)) return null;
  return c;
}

function buildHandoffFromSaved(p: SavedPlace, routePlaceId: string): PlaceDetailHandoff {
  return {
    placeId: routePlaceId,
    name: p.name,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    photoUrl: resolveSavedPlaceImageUrl(p),
    category: p.category,
  };
}

/**
 * 收藏地點導航用 route id：優先 Google placeId，否則 saved-{uuid}（非 Google id，詳情用 handoff）
 */
export function resolveSavedPlaceRouteId(p: SavedPlace): string {
  const fromMeta = normalizeGooglePlaceId(
    typeof p.metadata?.placeId === "string" ? p.metadata.placeId : undefined,
  );
  if (fromMeta) return fromMeta;
  if (p.id?.trim() && !p.id.startsWith("guest-")) {
    return `saved-${p.id.trim()}`;
  }
  if (p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    return latLngFallbackPlaceId(p.lat, p.lng);
  }
  return createTemporaryPlaceId();
}

function persistHandoff(routePlaceId: string, handoff: PlaceDetailHandoff): void {
  setPlaceDetailStoreEntry(routePlaceId, handoff);
  setPlaceDetailHandoff(handoff);
}

export type SavedPlaceDetailNavigate = (opts: {
  to: "/place/$placeId";
  params: { placeId: string };
  search: { from: string };
}) => Promise<void>;

export async function openSavedPlaceDetail(
  p: SavedPlace,
  _locale: Locale,
  navigate: SavedPlaceDetailNavigate,
): Promise<boolean> {
  const routePlaceId = resolveSavedPlaceRouteId(p);
  console.info("[SAVED_PLACE_CARD] clicked");
  console.info("[SAVED_PLACE_CARD] placeId=", routePlaceId);
  console.info("[PLACE_DETAIL] source=saved");
  console.info("[PLACE_DETAIL] preparing placeId=", routePlaceId);

  const hasCoords =
    p.lat != null &&
    p.lng != null &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng);

  const handoff = buildHandoffFromSaved(p, routePlaceId);
  persistHandoff(routePlaceId, handoff);
  if (routePlaceId.startsWith("saved-")) {
    const legacyKey = `temp:${routePlaceId}`;
    setPlaceDetailStoreEntry(legacyKey, handoff);
  }

  if (!p.name?.trim()) {
    console.info("[SAVED_PLACE_ROUTE] missing name");
    return false;
  }

  console.info("[SAVED_PLACE_ROUTE] push start");
  try {
    await navigate({
      to: "/place/$placeId",
      params: { placeId: routePlaceId },
      search: { from: "saved" },
    });
    console.info("[PLACE_DETAIL] route push ok placeId=", routePlaceId);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.info("[SAVED_PLACE_ROUTE] push error=", msg);
    console.info("[PLACE_DETAIL] fallback used=", "navigate_failed");

    if (typeof window !== "undefined") {
      const href = `/place/${encodeURIComponent(routePlaceId)}?from=saved`;
      try {
        window.history.pushState(window.history.state, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
        console.info("[SAVED_PLACE_ROUTE] history fallback ok path=", href);
        return true;
      } catch (historyErr) {
        console.info("[SAVED_PLACE_ROUTE] history fallback failed", historyErr);
      }
    }
    return false;
  }
}

/** @deprecated 僅供除錯：勿用 name+address 觸發 trip 搜尋 */
export function buildSavedPlaceSearchQuery(p: SavedPlace): string | null {
  const q = [p.name, p.address, sanitizeSavedCity(p.city)].filter(Boolean).join(" ").trim();
  return q || null;
}
