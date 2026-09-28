export type MarkerSnapshotItem = {
  id?: string | null;
  lat: number;
  lng: number;
  title?: string | null;
};

/** Stable marker identity for one visible place snapshot. */
export function markerSnapshotKey(marker: MarkerSnapshotItem): string {
  const id = marker.id?.trim();
  if (id) return `id:${id}`;
  const title = marker.title?.trim() || "";
  return `geo:${marker.lat.toFixed(5)}:${marker.lng.toFixed(5)}:${title}`;
}

export function markerSnapshotChanged(
  previous: readonly string[],
  next: readonly string[],
): boolean {
  if (previous.length !== next.length) return true;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return true;
  }
  return false;
}
