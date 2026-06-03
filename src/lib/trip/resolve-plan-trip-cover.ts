import type { Locale } from "@/lib/i18n/types";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import { getPlaceDetails, type PlaceLite } from "@/services/placesService";
import type { TripStopSuggestion } from "@/lib/trip-stop-search.functions";
import {
  defaultRoamieTripCover,
  getTripCoverImage,
  type TripCoverSource,
} from "@/services/placeImageService";

export type PlanTripCoverSource = "google" | TripCoverSource;

export type ResolvedPlanTripCover = {
  url: string;
  source: PlanTripCoverSource;
};

function isGooglePlacesPhotoUrl(url: string): boolean {
  return (
    url.includes("place-photo") ||
    url.includes("googleusercontent") ||
    url.includes("maps.googleapis")
  );
}

/** 規劃表單建立行程封面：Google Places → Unsplash → Roamie 預設 */
type ResolvePlaceFn = (
  data: { placeId: string; locale?: Locale; fallback?: TripStopSuggestion },
) => Promise<{ place: PlaceLite | null; error: string | null }>;

export async function resolvePlanTripCover(
  form: PlanTripFormInput,
  options?: {
    locale?: Locale;
    resolveFn?: ResolvePlaceFn;
  },
): Promise<ResolvedPlanTripCover> {
  const dest = form.destination;
  const destLabel = formatTripLocationLabel(dest);
  const locale = options?.locale ?? "zh-TW";

  if (dest.placeId?.trim()) {
    try {
      const { place } = await getPlaceDetails(dest.placeId, {
        locale,
        resolveFn: options?.resolveFn,
        fallback: {
          placeId: dest.placeId,
          label: destLabel,
          secondary: dest.address || "",
        },
      });
      const photoName = place?.photoName?.trim();
      if (photoName) {
        const url = buildPlacePhotoUrl(photoName, 800);
        if (url) {
          console.info("[PLAN_TRIP_COVER] source=google destination=", destLabel);
          return { url, source: "google" };
        }
      }
    } catch (e) {
      console.warn("[PLAN_TRIP_COVER] google photo skipped", e);
    }
  }

  try {
    const cover = await getTripCoverImage({
      destination: destLabel,
      title: destLabel,
      city: dest.city,
      mood: "",
      moodTag: "",
    });
    if (cover.url && cover.source === "unsplash") {
      console.info("[PLAN_TRIP_COVER] source=unsplash destination=", destLabel);
      return { url: cover.url, source: "unsplash" };
    }
  } catch (e) {
    console.warn("[PLAN_TRIP_COVER] unsplash skipped", e);
  }

  console.info("[PLAN_TRIP_COVER] source=default destination=", destLabel);
  return { url: defaultRoamieTripCover, source: "default" };
}

export function planTripCoverSourceForStorage(
  source: PlanTripCoverSource,
): TripCoverSource | "google" {
  if (source === "google") return "google";
  return source;
}

export { isGooglePlacesPhotoUrl };
