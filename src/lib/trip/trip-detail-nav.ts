import type { NavigateOptions } from "@tanstack/react-router";

export const TRIP_DETAIL_ROUTE = "/saved/$tripId" as const;
export const TRIP_DETAIL_COMPONENT = "TripDetailScreen";

/** 進入行程詳情前的 debug log（首頁／收藏／聊天等入口共用） */
export function logTripNav(source: string, tripId: string): void {
  const normalized = source.toLowerCase().includes("home")
    ? "home"
    : source.toLowerCase().includes("saved")
      ? "saved"
      : source;
  console.info(`[TRIP_NAV] source=${normalized} tripId=${tripId}`);
}

export function tripDetailNavigateOptions(tripId: string): NavigateOptions {
  return {
    to: TRIP_DETAIL_ROUTE,
    params: { tripId },
  };
}
