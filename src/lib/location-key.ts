/** 3 位小數座標 bucket — 獨立模組，避免 effective-location ↔ explore 循環 chunk 依賴 */
export function normalizedLocationKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)}:${lng.toFixed(3)}`;
}
