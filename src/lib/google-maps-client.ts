/** Browser-only Google Maps key (from Vite env). */

export function getGoogleMapsBrowserKey(): string {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!key?.trim()) {
    throw new Error("VITE_GOOGLE_MAPS_API_KEY 未設定，無法載入地圖。");
  }
  return key.trim();
}

export function buildPlacePhotoUrl(photoName: string, maxWidth = 600): string {
  const key = getGoogleMapsBrowserKey();
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${key}`;
}
