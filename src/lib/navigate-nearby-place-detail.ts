import type { HomeNearbyPick } from "@/lib/explore-category-search";
import {
  isRoutableGooglePlaceId,
  latLngFallbackPlaceId,
  pickToPlaceDetailHandoff,
  setPlaceDetailHandoff,
} from "@/lib/place-detail-handoff";
import { setPlaceDetailStoreEntry } from "@/lib/place-detail-store";
import {
  logNearbyPlaceCardPressed,
  logNearbyPlaceId,
  logNearbyPlaceNavigateParams,
  logNearbyPlaceNavigateToDetail,
} from "@/lib/place-detail-log";

export type NavigateToPlaceDetail = (opts: {
  to: "/place/$placeId";
  params: { placeId: string };
  search?: { from?: string };
}) => Promise<void> | void;

export function resolveNearbyPlaceRouteId(pick: HomeNearbyPick): string | null {
  let placeId = (pick.id?.trim() ?? "").replace(/^places\//, "");
  if (!placeId && pick.lat != null && pick.lng != null) {
    placeId = latLngFallbackPlaceId(pick.lat, pick.lng);
  }
  if (!placeId) return null;

  if (
    !isRoutableGooglePlaceId(placeId) &&
    !placeId.startsWith("mock-") &&
    !placeId.startsWith("latlng:")
  ) {
    if (pick.lat != null && pick.lng != null) {
      placeId = latLngFallbackPlaceId(pick.lat, pick.lng);
    } else {
      return null;
    }
  }

  return placeId;
}

/** 首頁／探索附近卡片統一導向地點詳情 */
export async function navigateToNearbyPlaceDetail(
  pick: HomeNearbyPick,
  navigate: NavigateToPlaceDetail,
  opts?: { from?: string },
): Promise<boolean> {
  logNearbyPlaceCardPressed(pick.id, pick.name);
  logNearbyPlaceId(pick.id);

  const placeId = resolveNearbyPlaceRouteId(pick);
  if (!placeId) return false;

  const handoff = { ...pickToPlaceDetailHandoff(pick), placeId };
  logNearbyPlaceNavigateParams(handoff);
  setPlaceDetailHandoff(handoff);
  setPlaceDetailStoreEntry(placeId, handoff);
  logNearbyPlaceNavigateToDetail();

  await navigate({
    to: "/place/$placeId",
    params: { placeId },
    search: { from: opts?.from ?? "home" },
  });
  return true;
}
