import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";
import { canReachBundledAppApiOrigin, resolveAppApiUrl } from "@/lib/api-base-url";
import {
  googleMapsKeyMissingMessage,
  logGoogleMapsKeyLoadedOnce,
  readGoogleMapsKeyFromClientEnv,
} from "@/lib/google-maps-key-resolve";
import { detectPlatform } from "@/services/platform";

const INVALID_KEY_MSG =
  "Google 地圖 API 金鑰格式不正確。請使用 Maps JavaScript API 的瀏覽器金鑰（通常以 AIza 開頭）。";

export function getGoogleMapsBrowserKey(): string | null {
  return readGoogleMapsKeyFromClientEnv();
}

export function getGoogleMapsBrowserKeyError(): string | null {
  const key = getGoogleMapsBrowserKey();
  if (!key) return googleMapsKeyMissingMessage();
  if (!isValidGoogleMapsApiKey(key)) return INVALID_KEY_MSG;
  logGoogleMapsKeyLoadedOnce();
  return null;
}

export function requireGoogleMapsBrowserKey(): string {
  const err = getGoogleMapsBrowserKeyError();
  if (err) throw new Error(err);
  logGoogleMapsKeyLoadedOnce();
  return getGoogleMapsBrowserKey()!;
}

function directGooglePlacePhotoUrl(photoName: string, maxWidth: number): string | null {
  const key = getGoogleMapsBrowserKey();
  if (!key || !isValidGoogleMapsApiKey(key)) return null;
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${key}`;
}

export function buildPlacePhotoUrl(photoName: string, maxWidth = 600): string | null {
  if (!photoName?.trim()) return null;
  const proxyPath = `/api/place-photo?photo=${encodeURIComponent(photoName)}&w=${maxWidth}`;
  const { isCapacitor } = detectPlatform();

  if (isCapacitor) {
    if (canReachBundledAppApiOrigin()) {
      const proxied = resolveAppApiUrl(proxyPath);
      if (proxied.startsWith("http")) return proxied;
    }
    return directGooglePlacePhotoUrl(photoName, maxWidth);
  }

  const direct = directGooglePlacePhotoUrl(photoName, maxWidth);
  if (direct) return direct;
  return proxyPath;
}
