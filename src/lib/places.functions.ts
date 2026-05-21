import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PLACES_FIELD_MASK, placesSearchTextUrl, requireGoogleMapsServerKey } from "@/lib/google-maps.server";
import { deriveOpenStatus, openStatusSortWeight, type OpenStatus } from "@/lib/place-hours";

export type PlaceResult = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  userRatingCount: number | null;
  photoName: string | null;
  primaryType: string | null;
  openStatus: OpenStatus;
  openStatusLabel: "" | "營業中" | "即將打烊" | "今日休息";
};

const NearbyInput = z.object({
  query: z.string().min(1).max(120),
  city: z.string().max(80).optional().default(""),
  lat: z.number().optional(),
  lng: z.number().optional(),
  radius: z.number().min(100).max(50000).optional().default(20000),
});

function parseGoogleError(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string; status?: string } };
    if (j.error?.message) return `${j.error.status ?? "ERROR"}: ${j.error.message}`;
  } catch {
    /* ignore */
  }
  return text.slice(0, 200);
}

export const searchPlaces = createServerFn({ method: "POST" })
  .inputValidator((input) => NearbyInput.parse(input))
  .handler(async ({ data }): Promise<{ places: PlaceResult[]; error: string | null }> => {
    try {
      const apiKey = requireGoogleMapsServerKey();
      const textQuery = data.city ? `${data.query} ${data.city}` : data.query;
      const body: Record<string, unknown> = {
        textQuery,
        languageCode: "zh-TW",
        pageSize: 20,
      };
      if (typeof data.lat === "number" && typeof data.lng === "number") {
        body.locationBias = {
          circle: {
            center: { latitude: data.lat, longitude: data.lng },
            radius: data.radius,
          },
        };
      }

      const res = await fetch(placesSearchTextUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": PLACES_FIELD_MASK,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        const detail = parseGoogleError(text);
        console.error("[Roamie Places] searchText failed", res.status, detail);
        return { places: [], error: `Google Places API ${res.status}: ${detail}` };
      }

      const json = (await res.json()) as {
        places?: Array<{
          id: string;
          displayName?: { text?: string };
          formattedAddress?: string;
          location?: { latitude: number; longitude: number };
          rating?: number;
          userRatingCount?: number;
          photos?: Array<{ name: string }>;
          primaryType?: string;
          businessStatus?: string;
          currentOpeningHours?: { openNow?: boolean; nextCloseTime?: string };
        }>;
      };

      const places: PlaceResult[] = (json.places ?? [])
        .map((p) => {
          const open = deriveOpenStatus({
            businessStatus: p.businessStatus,
            currentOpeningHours: p.currentOpeningHours,
          });
          return {
            id: p.id,
            name: p.displayName?.text ?? "Unknown",
            address: p.formattedAddress ?? null,
            lat: p.location?.latitude ?? null,
            lng: p.location?.longitude ?? null,
            rating: p.rating ?? null,
            userRatingCount: p.userRatingCount ?? null,
            photoName: p.photos?.[0]?.name ?? null,
            primaryType: p.primaryType ?? null,
            openStatus: open.status,
            openStatusLabel: open.label,
          };
        })
        .sort((a, b) => openStatusSortWeight(a.openStatus) - openStatusSortWeight(b.openStatus));

      console.info("[Roamie Places] searchText ok", places.length, "results for", textQuery);
      return { places, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "request failed";
      console.error("[Roamie Places] searchText threw", msg);
      return { places: [], error: msg };
    }
  });