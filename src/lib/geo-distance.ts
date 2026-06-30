/** Haversine 距離（公尺）。獨立模組，避免 device-location lazy chunk 循環依賴 map-explore / index。 */
const EARTH_RADIUS_M = 6371000;

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
}

/** Haversine 距離（公里）；座標無效時回傳 null */
export function calculateDistanceKm(
  centerLat: number,
  centerLng: number,
  placeLat: number | null | undefined,
  placeLng: number | null | undefined,
): number | null {
  if (placeLat == null || placeLng == null) return null;
  if (
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLng) ||
    !Number.isFinite(placeLat) ||
    !Number.isFinite(placeLng)
  ) {
    return null;
  }
  const meters = distanceMeters({ lat: centerLat, lng: centerLng }, { lat: placeLat, lng: placeLng });
  if (!Number.isFinite(meters)) return null;
  return meters / 1000;
}

export function formatDistanceLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
