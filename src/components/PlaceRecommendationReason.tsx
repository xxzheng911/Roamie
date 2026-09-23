import { useCallback, useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/use-i18n";
import {
  buildPlaceRecommendationReason,
  resolveRecommendationReasonPlace,
} from "@/lib/build-place-recommendation-reason";
import { PLACE_RUNTIME_CACHE_UPDATED, readPlaceRuntimeCache } from "@/lib/place-runtime-cache";

type ReasonPlace = Parameters<typeof resolveRecommendationReasonPlace>[0];

/** All surfaces project the same evidence. Cache notifications never trigger network work. */
export function PlaceRecommendationReason({
  place,
  presentation = "standard",
}: {
  place: ReasonPlace;
  presentation?: "compact" | "standard" | "detail";
}) {
  const { locale } = useI18n();
  const id = resolveRecommendationReasonPlace(place).id;
  const subscribe = useCallback(
    (refresh: () => void) => {
      const update = (event: Event) => {
        if ((event as CustomEvent<{ placeId: string }>).detail?.placeId === id) refresh();
      };
      window.addEventListener(PLACE_RUNTIME_CACHE_UPDATED, update);
      return () => window.removeEventListener(PLACE_RUNTIME_CACHE_UPDATED, update);
    },
    [id],
  );
  const getSnapshot = useCallback(() => readPlaceRuntimeCache(id)?.reasonPlace ?? null, [id]);
  // React rechecks after subscribing, so enrichment between render and subscription is not lost.
  useSyncExternalStore(subscribe, getSnapshot, () => null);
  return (
    <>
      {buildPlaceRecommendationReason(
        resolveRecommendationReasonPlace(place),
        null,
        null,
        undefined,
        { presentation, surface: typeof window === "undefined" ? "ssr" : window.location.pathname },
        locale,
      )}
    </>
  );
}
