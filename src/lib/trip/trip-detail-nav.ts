import type { NavigateOptions } from "@tanstack/react-router";
import { logTripDetailNavSkipped } from "@/lib/trip/trip-detail-log";
import type { TripDetailFromSource } from "@/lib/trip/trip-detail-back";

export const TRIP_DETAIL_ROUTE = "/saved/$tripId" as const;
export const TRIP_DETAIL_COMPONENT = "TripDetailScreen";

/** @deprecated 請改用 `from` */
export type TripDetailBackSource = "saved";

export type TripDetailNavOptions = {
  /** 進入詳情頁的來源，決定返回目的地 */
  from?: TripDetailFromSource;
  /** @deprecated 請改用 `from: "saved"` */
  back?: TripDetailBackSource;
  /** 以 replace 導向，避免返回到規劃／聊天頁 */
  replace?: boolean;
};

const lastTripNavLog = { tripId: "", source: "", at: 0 };
const NAV_LOG_DEDUPE_MS = 3_000;

/** 進入行程詳情前的 debug log（首頁／收藏／聊天等入口共用） */
export function logTripNav(source: string, tripId: string): void {
  const now = Date.now();
  if (
    lastTripNavLog.tripId === tripId &&
    lastTripNavLog.source === source &&
    now - lastTripNavLog.at < NAV_LOG_DEDUPE_MS
  ) {
    logTripDetailNavSkipped(tripId, "duplicate_within_3s");
    return;
  }
  lastTripNavLog.tripId = tripId;
  lastTripNavLog.source = source;
  lastTripNavLog.at = now;

  const normalized = source.toLowerCase().includes("home")
    ? "home"
    : source.toLowerCase().includes("saved")
      ? "saved"
      : source;
  console.info(`[TRIP_NAV] source=${normalized} tripId=${tripId}`);
}

export function tripDetailNavigateOptions(
  tripId: string,
  options?: TripDetailNavOptions,
): NavigateOptions {
  const from = options?.from ?? (options?.back === "saved" ? "saved" : undefined);
  return {
    to: TRIP_DETAIL_ROUTE,
    params: { tripId },
    search: from ? { from } : undefined,
    replace: options?.replace,
  };
}
