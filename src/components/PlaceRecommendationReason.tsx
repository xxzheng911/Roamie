import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { useAccessOptional } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import {
  buildPlaceRecommendationReason,
  resolveRecommendationReasonPlace,
  type PlaceReasonContextSnapshot,
} from "@/lib/build-place-recommendation-reason";
import { PLACE_RUNTIME_CACHE_UPDATED, readPlaceRuntimeCache } from "@/lib/place-runtime-cache";
import {
  REASON_PROFILE_UPDATED,
  ensureReasonProfile,
  readReasonProfileSync,
} from "@/lib/reason-personalization-store";

type ReasonPlace = Parameters<typeof resolveRecommendationReasonPlace>[0] & {
  reasonContext?: PlaceReasonContextSnapshot;
};

const subscribeProfile = (refresh: () => void) => {
  window.addEventListener(REASON_PROFILE_UPDATED, refresh);
  return () => window.removeEventListener(REASON_PROFILE_UPDATED, refresh);
};

/**
 * All surfaces project the same V2 reason authority: Place evidence + the card's persisted
 * reason context + the owner-bound Plus snapshot. Stored reason text is never trusted, and
 * cache notifications never trigger network or AI work.
 */
export function PlaceRecommendationReason({
  place,
  presentation = "standard",
}: {
  place: ReasonPlace;
  presentation?: "compact" | "standard" | "detail";
}) {
  const { locale } = useI18n();
  const hasPlusAccess = useAccessOptional()?.hasPlusAccess === true;
  // The signed-in viewer (not a cached id) owns the snapshot; changes re-render and re-gate it.
  const viewerId = useAuth().user?.id ?? null;
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
  const profile = useSyncExternalStore(
    subscribeProfile,
    () => readReasonProfileSync(hasPlusAccess, viewerId),
    () => null,
  );
  useEffect(() => ensureReasonProfile(hasPlusAccess, viewerId), [hasPlusAccess, viewerId]);
  return (
    <>
      {buildPlaceRecommendationReason(
        resolveRecommendationReasonPlace(place),
        profile,
        null,
        undefined,
        {
          ...place.reasonContext,
          presentation,
          surface: typeof window === "undefined" ? "ssr" : window.location.pathname,
        },
        locale,
      )}
    </>
  );
}
