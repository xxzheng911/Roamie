/** 台北市中心 — 僅在無法取得裝置定位時使用（非 IP、非美國預設） */
export const TAIPEI_CENTER = { lat: 25.0478, lng: 121.5319 };

/** 排除常見錯誤／IP fallback 到美國的座標 */
export function isSuspiciousUsLocation(lat: number, lng: number): boolean {
  return lng >= -170 && lng <= -60 && lat >= 18 && lat <= 72;
}

export function isValidDeviceCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (isSuspiciousUsLocation(lat, lng)) return false;
  return true;
}

export function normalizeDeviceLocation(
  lat: number,
  lng: number,
): { lat: number; lng: number } | null {
  if (!isValidDeviceCoordinate(lat, lng)) return null;
  return { lat, lng };
}
