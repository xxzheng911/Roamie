import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";

/** Browser-only Google Maps key (from Vite env). */

const MISSING_KEY_MSG =
  "尚未設定 Google 地圖 API 金鑰。請在 .env 設定 VITE_GOOGLE_MAPS_API_KEY 後重新啟動。";

const INVALID_KEY_MSG =
  "Google 地圖 API 金鑰格式不正確。請使用 Maps JavaScript API 的瀏覽器金鑰（通常以 AIza 開頭）。";

export function getGoogleMapsBrowserKey(): string | null {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const trimmed = key?.trim();
  return trimmed || null;
}

export function getGoogleMapsBrowserKeyError(): string | null {
  const key = getGoogleMapsBrowserKey();
  if (!key) return MISSING_KEY_MSG;
  if (!isValidGoogleMapsApiKey(key)) return INVALID_KEY_MSG;
  return null;
}

export function requireGoogleMapsBrowserKey(): string {
  const err = getGoogleMapsBrowserKeyError();
  if (err) throw new Error(err);
  return getGoogleMapsBrowserKey()!;
}

export function buildPlacePhotoUrl(photoName: string, maxWidth = 600): string | null {
  const key = getGoogleMapsBrowserKey();
  if (!key || !isValidGoogleMapsApiKey(key)) return null;
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${key}`;
}
