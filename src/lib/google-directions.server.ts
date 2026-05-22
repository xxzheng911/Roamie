import { requireGoogleMapsServerKey } from "@/lib/google-maps.server";

export type DistanceMatrixMode = "walking" | "driving" | "transit";

export type LegDurationEstimate = {
  walk?: number;
  drive?: number;
  transit?: number;
  distanceMeters: number;
};

type MatrixRow = {
  elements: Array<{
    status: string;
    duration?: { value: number };
    distance?: { value: number };
  }>;
};

/**
 * Google Distance Matrix — 單段點對點（多種 mode）
 * https://developers.google.com/maps/documentation/distance-matrix
 */
export async function fetchLegDurations(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<LegDurationEstimate> {
  const apiKey = requireGoogleMapsServerKey();
  const originStr = `${origin.lat},${origin.lng}`;
  const destStr = `${destination.lat},${destination.lng}`;

  const modes: DistanceMatrixMode[] = ["walking", "driving", "transit"];
  const out: LegDurationEstimate = { distanceMeters: 0 };

  await Promise.all(
    modes.map(async (mode) => {
      try {
        const params = new URLSearchParams({
          origins: originStr,
          destinations: destStr,
          mode,
          language: "zh-TW",
          region: "tw",
          key: apiKey,
        });
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          status?: string;
          rows?: MatrixRow[];
        };
        if (json.status !== "OK" || !json.rows?.[0]?.elements?.[0]) return;
        const el = json.rows[0].elements[0];
        if (el.status !== "OK" || !el.duration) return;
        const minutes = Math.max(1, Math.round(el.duration.value / 60));
        if (mode === "walking") out.walk = minutes;
        if (mode === "driving") out.drive = minutes;
        if (mode === "transit") out.transit = minutes;
        if (el.distance?.value) {
          out.distanceMeters = Math.max(out.distanceMeters, el.distance.value);
        }
      } catch (e) {
        console.warn("[Roamie Directions] matrix mode failed", mode, e);
      }
    }),
  );

  if (out.distanceMeters === 0) {
    out.distanceMeters = haversineMeters(origin, destination);
  }

  return out;
}

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}
