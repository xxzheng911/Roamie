/** 台北市中心 — 歷史預設；新 fallback 請用 DEFAULT_APP_FALLBACK_CENTER */
export const TAIPEI_CENTER = { lat: 25.0478, lng: 121.5319 };

/** 無 GPS / 無 last-known / 無搜尋城市時的 App 預設中心（高雄） */
export const DEFAULT_APP_FALLBACK_CENTER = { lat: 22.6273, lng: 120.3014 } as const;

const CENTER_EPS = 0.0001;

/** 是否為預設台北 fallback 座標（反查常顯示「中山」） */
export function isDefaultTaipeiCenter(lat: number, lng: number): boolean {
  return (
    Math.abs(lat - TAIPEI_CENTER.lat) < CENTER_EPS &&
    Math.abs(lng - TAIPEI_CENTER.lng) < CENTER_EPS
  );
}

export function isDefaultKaohsiungCenter(lat: number, lng: number): boolean {
  return (
    Math.abs(lat - DEFAULT_APP_FALLBACK_CENTER.lat) < CENTER_EPS &&
    Math.abs(lng - DEFAULT_APP_FALLBACK_CENTER.lng) < CENTER_EPS
  );
}

/** 是否為 App 內建預設 fallback 中心（不應記為 last-known） */
export function isDefaultFallbackCenter(lat: number, lng: number): boolean {
  return isDefaultTaipeiCenter(lat, lng) || isDefaultKaohsiungCenter(lat, lng);
}

export function isValidDeviceCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

export function normalizeDeviceLocation(
  lat: number,
  lng: number,
): { lat: number; lng: number } | null {
  if (!isValidDeviceCoordinate(lat, lng)) return null;
  return { lat, lng };
}
