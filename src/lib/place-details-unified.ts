import { canReachBundledAppApiOrigin } from "@/lib/api-base-url";
import { fetchPlaceDetailsViaBundledApi } from "@/lib/place-details-api";
import type { PlaceDetailsScreenResult } from "@/lib/places.functions";
import { detectPlatform } from "@/services/platform";

export type PlaceDetailsFetchFn = (input: {
  data: { placeId: string; locale?: "zh-TW" | "en" | "ja" | "ko" };
}) => Promise<{ place: PlaceDetailsScreenResult | null; error: string | null }>;

function shouldUseBundledPlaceDetailsHttp(): boolean {
  if (typeof window === "undefined") return false;
  if (!canReachBundledAppApiOrigin()) return false;
  const platform = detectPlatform();
  return (
    platform.isCapacitor ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "ionic:"
  );
}

/** Web：serverFn；Capacitor：POST /api/place-details */
export function createUnifiedPlaceDetailsFn(serverFn: PlaceDetailsFetchFn): PlaceDetailsFetchFn {
  const useBundled = shouldUseBundledPlaceDetailsHttp();

  return async (input) => {
    if (useBundled) {
      const result = await fetchPlaceDetailsViaBundledApi({
        placeId: input.data.placeId,
        locale: input.data.locale,
      });
      console.info("[PLACE_DETAILS] bundled_http", {
        placeId: input.data.placeId.slice(0, 12),
        ok: Boolean(result.place),
        error: result.error,
      });
      return result;
    }

    try {
      return await serverFn(input);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "place_details_failed";
      console.warn("[PLACE_DETAILS] serverFn failed", msg);
      return { place: null, error: msg };
    }
  };
}
