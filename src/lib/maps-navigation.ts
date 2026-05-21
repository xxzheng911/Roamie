export type LatLng = { lat: number; lng: number };

export function buildPlaceMapsUrl(lat: number, lng: number, placeName?: string): string {
  const q = placeName ? encodeURIComponent(placeName) : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=&center=${lat}%2C${lng}`;
}

export function buildDirectionsUrl(
  destination: LatLng,
  options?: { origin?: LatLng; waypoints?: LatLng[]; travelMode?: "driving" | "walking" | "transit" | "bicycling" },
): string {
  const params = new URLSearchParams({ api: "1", destination: `${destination.lat},${destination.lng}` });
  if (options?.origin) params.set("origin", `${options.origin.lat},${options.origin.lng}`);
  if (options?.waypoints?.length) {
    params.set("waypoints", options.waypoints.map((w) => `${w.lat},${w.lng}`).join("|"));
  }
  if (options?.travelMode) params.set("travelmode", options.travelMode);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function buildDirectionsUrlFromQuery(query: string, origin?: LatLng): string {
  const params = new URLSearchParams({ api: "1", destination: query });
  if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function openExternal(url: string): void {
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}
