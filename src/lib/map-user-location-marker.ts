import defaultTraveler from "@/assets/roamie-traveler.jpg";
import { preferNonWebpImageUrl } from "@/lib/safe-image-url";

/** 使用者定位 marker 預設頭像（bundled，一定存在） */
export const DEFAULT_USER_MARKER_AVATAR = defaultTraveler;

/** 安全解析大頭貼 URL，避免 undefined / 空字串 / WebP 導致 marker 異常 */
export function resolveUserMarkerAvatarSrc(src?: string | null): string {
  if (typeof src === "string") {
    const trimmed = src.trim();
    if (trimmed.length > 0) {
      return preferNonWebpImageUrl(trimmed) ?? DEFAULT_USER_MARKER_AVATAR;
    }
  }
  return DEFAULT_USER_MARKER_AVATAR;
}

export function isGoogleMapsOverlayReady(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.google?.maps?.OverlayView === "function" &&
    typeof window.google?.maps?.LatLng === "function"
  );
}
