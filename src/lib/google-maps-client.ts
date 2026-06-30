import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";
import {
  googleMapsKeyMissingMessage,
  logGoogleMapsKeyLoadedOnce,
  readGoogleMapsKeyFromClientEnv,
} from "@/lib/google-maps-key-resolve";
import { buildPlacePhotoProxyUrl } from "@/lib/safe-image-url";

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

export function buildPlacePhotoUrl(photoName: string, maxWidth = 600): string | null {
  const normalized = photoName?.trim();
  if (!normalized) return null;
  // 永不直連 Google media（常回 WebP）；一律走 proxy URL（img 直接載入，不經 CapacitorHttp）
  return buildPlacePhotoProxyUrl(normalized, maxWidth);
}
