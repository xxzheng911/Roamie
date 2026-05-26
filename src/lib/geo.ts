/** 台北市中心 — 僅在無法取得裝置定位時使用 */
export const TAIPEI_CENTER = { lat: 25.0478, lng: 121.5319 };

const TAIPEI_EPS = 0.0001;

/** 是否為預設台北 fallback 座標（反查常顯示「中山」） */
export function isDefaultTaipeiCenter(lat: number, lng: number): boolean {
  return (
    Math.abs(lat - TAIPEI_CENTER.lat) < TAIPEI_EPS &&
    Math.abs(lng - TAIPEI_CENTER.lng) < TAIPEI_EPS
  );
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
