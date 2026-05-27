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

export async function openExternal(url: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { detectPlatform } = await import("@/services/platform");
    if (detectPlatform().isCapacitor) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    }
  } catch {
    /* fallback below */
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

type PlaceNavigationTarget = {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  placeName?: string;
};

function tryOpenUrl(url: string): void {
  if (typeof window === "undefined") return;
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  window.setTimeout(() => {
    iframe.remove();
  }, 1200);
}

/**
 * 開啟導航：優先 Google Maps app，其次 Apple Maps，最後瀏覽器 Google Maps。
 */
export function openPlaceNavigation(target: PlaceNavigationTarget): void {
  const { lat, lng, address, placeName } = target;
  const hasCoords =
    lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
  const label = placeName?.trim() || address?.trim() || "目的地";

  const webUrl = hasCoords
    ? buildDirectionsUrl({ lat: lat!, lng: lng! })
    : address || label
      ? buildDirectionsUrlFromQuery(address || label)
      : null;

  if (!webUrl) return;

  if (hasCoords) {
    tryOpenUrl(`comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`);
    const isApple =
      typeof navigator !== "undefined" &&
      /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isApple) {
      window.setTimeout(() => {
        tryOpenUrl(`maps://?daddr=${lat},${lng}`);
      }, 350);
    }
  } else {
    const q = encodeURIComponent(address || label);
    tryOpenUrl(`comgooglemaps://?q=${q}&directionsmode=driving`);
  }

  window.setTimeout(() => {
    void openExternal(webUrl);
  }, hasCoords ? 700 : 400);
}
