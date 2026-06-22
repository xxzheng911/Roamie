import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

export type LatLng = { lat: number; lng: number };

export function buildPlaceMapsUrl(lat: number, lng: number, placeName?: string): string {
  const q = placeName ? encodeURIComponent(placeName) : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=&center=${lat}%2C${lng}`;
}

export function buildDirectionsUrl(
  destination: LatLng,
  options?: {
    origin?: LatLng;
    waypoints?: LatLng[];
    travelMode?: "driving" | "walking" | "transit" | "bicycling";
  },
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

/** Capacitor：Browser.open 開 Safari / Google Maps；Web 才用 window.open */
export async function openExternal(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;

  if (isCapacitorNativeShell()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: trimmed, presentationStyle: "fullscreen" });
      return;
    } catch (e) {
      console.warn("[maps-navigation] Capacitor Browser.open failed", e);
    }
  }

  if (typeof window !== "undefined") {
    window.open(trimmed, "_blank", "noopener,noreferrer");
  }
}
