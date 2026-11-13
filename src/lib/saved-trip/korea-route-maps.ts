import type { TransitLegAdvice } from "@/lib/transit/types";
import { openExternal, type LatLng } from "@/lib/maps-navigation";
import { travelLabelToRoutesMode } from "@/services/routesService";

/** Korea WALK/DRIVE legs: Google Routes returns no result, so offer Naver Map (https web URL only). */
export function koreaNaverModeForLeg(
  region: string,
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
): "walk" | "car" | null {
  if (region !== "kr" || !leg) return null;
  const status = leg.routeStatus ?? leg.transportStatus;
  if (status !== "failed" && status !== "mode_unavailable" && status !== "transit_unavailable") return null;
  const mode = travelLabelToRoutesMode(transportLabel);
  if (mode === "WALK") return "walk";
  if (mode === "DRIVE") return "car";
  return null;
}

/**
 * 推測格式（來自外部文件記憶，未連網驗證，需實機點擊確認）：
 * https://map.naver.com/p/directions/{slng},{slat},{sname},,/{elng},{elat},{ename},,/-/{walk|car|transit}
 * 經度在前。
 */
export function buildNaverDirectionsUrl(
  origin: LatLng,
  originName: string,
  destination: LatLng,
  destinationName: string,
  mode: "walk" | "car" | "transit",
): string {
  const seg = (p: LatLng, name: string) => `${p.lng},${p.lat},${encodeURIComponent(name)},,`;
  return `https://map.naver.com/p/directions/${seg(origin, originName)}/${seg(destination, destinationName)}/-/${mode}`;
}

export function openKoreaLegInNaverMap(
  origin: LatLng,
  originName: string,
  destination: LatLng,
  destinationName: string,
  mode: "walk" | "car",
): void {
  void openExternal(buildNaverDirectionsUrl(origin, originName, destination, destinationName, mode));
}
