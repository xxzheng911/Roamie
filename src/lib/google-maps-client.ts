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

function proxyGooglePlacePhotoUrl(photoName: string, maxWidth: number): string {
  const proxyPath = `/api/place-photo?photo=${encodeURIComponent(photoName)}&w=${maxWidth}`;
  const { isCapacitor } = detectPlatform();
  if (isCapacitor && canReachBundledAppApiOrigin()) {
    const resolved = resolveAppApiUrl(proxyPath);
    if (resolved.startsWith("http")) return resolved;
  }
  return proxyPath;
}

export function buildPlacePhotoCandidateUrls(photoName: string, maxWidth = 600): string[] {
  if (!photoName?.trim()) return [];
  const direct = directGooglePlacePhotoUrl(photoName, maxWidth);
  const proxy = proxyGooglePlacePhotoUrl(photoName, maxWidth);
  const candidates = [direct, proxy].filter((u): u is string => Boolean(u?.trim()));
  return [...new Set(candidates)];
}

export function buildPlacePhotoUrl(photoName: string, maxWidth = 600): string | null {
  if (!photoName?.trim()) return null;
  return buildPlacePhotoCandidateUrls(photoName, maxWidth)[0] ?? null;
}
