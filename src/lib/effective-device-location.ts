import { readBootstrapDeviceLocation } from "@/lib/device-location";
import { isValidDeviceCoordinate } from "@/lib/geo";
import { getFreshDeviceLocationSnapshot } from "@/lib/location-store";

export type EffectiveCoords = {
  lat: number;
  lng: number;
  city?: string;
  source: "session" | "location_store" | "bootstrap";
};

export function pickUsableCoords(
  ...candidates: Array<{ lat: number; lng: number; city?: string } | null | undefined>
): EffectiveCoords | null {
  for (const c of candidates) {
    if (!c) continue;
    if (isValidDeviceCoordinate(c.lat, c.lng)) {
      return { lat: c.lat, lng: c.lng, city: c.city };
    }
  }
  return null;
}

/** Session / GPS / 台北 fallback — 排除 (0,0) 等無效座標 */
export function resolveEffectiveDeviceCoords(options?: {
  sessionLocation?: { lat?: number | null; lng?: number | null; city?: string | null } | null;
}): EffectiveCoords | null {
  const session =
    options?.sessionLocation?.lat != null && options.sessionLocation?.lng != null
      ? {
          lat: options.sessionLocation.lat,
          lng: options.sessionLocation.lng,
          city: options.sessionLocation.city ?? undefined,
        }
      : null;
  if (session && isValidDeviceCoordinate(session.lat, session.lng)) {
    return { ...session, source: "session" };
  }

  const snap = getFreshDeviceLocationSnapshot(120_000);
  if (snap && isValidDeviceCoordinate(snap.lat, snap.lng)) {
    return { lat: snap.lat, lng: snap.lng, city: snap.city, source: "location_store" };
  }

  const boot = readBootstrapDeviceLocation();
  if (isValidDeviceCoordinate(boot.lat, boot.lng)) {
    return { lat: boot.lat, lng: boot.lng, city: boot.city, source: "bootstrap" };
  }

  return null;
}
