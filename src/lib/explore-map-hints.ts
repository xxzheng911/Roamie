import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";
import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import type { ExploreMapQualityTier } from "@/lib/explore-places-eligibility";

export type ExploreMapSelectionMeta = {
  lowestTier: ExploreMapQualityTier | null;
  hasTier2: boolean;
  hasTier3: boolean;
};

export function getExploreMapFallbackHint(
  meta: ExploreMapSelectionMeta | null | undefined,
  locale: Locale,
): string | null {
  if (!meta || meta.lowestTier == null || meta.lowestTier === 1) return null;
  if (meta.hasTier3 && !meta.hasTier2) {
    return translate(locale, "explore.hint.closedSave");
  }
  if (meta.hasTier3) {
    return translate(locale, "explore.hint.openScarce");
  }
  if (meta.hasTier2) {
    return translate(locale, "explore.hint.hoursUnknown");
  }
  return null;
}

function resolveExploreQualityTier(place: {
  exploreQualityTier?: ExploreMapQualityTier | null;
  openStatusLabel?: string;
  normalizedOpeningLabel?: string;
  openNow?: boolean | null;
  openStatus?: PlaceOpenStatus | string;
}): ExploreMapQualityTier | null {
  if (place.exploreQualityTier != null) return place.exploreQualityTier;

  const label = (place.normalizedOpeningLabel ?? place.openStatusLabel ?? "").trim();
  if (/休息中|未營業|closed/i.test(label)) return 3;
  if (/待確認|unknown|未確認/i.test(label)) return 2;

  if (place.openNow === true || place.openStatus === "open" || place.openStatus === "closing_soon") {
    return 1;
  }
  if (
    place.openNow === false ||
    place.openStatus === "closed_now" ||
    place.openStatus === "permanently_closed" ||
    place.openStatus === "temporarily_closed"
  ) {
    return 3;
  }
  if (place.openNow == null || place.openStatus === "unknown") return 2;
  return null;
}

export function inferExploreMapSelectionMeta(
  places: Array<{
    exploreQualityTier?: ExploreMapQualityTier | null;
    openStatusLabel?: string;
    normalizedOpeningLabel?: string;
    openNow?: boolean | null;
    openStatus?: PlaceOpenStatus | string;
  }>,
): ExploreMapSelectionMeta {
  let lowestTier: ExploreMapQualityTier | null = null;
  let hasTier2 = false;
  let hasTier3 = false;
  for (const place of places) {
    const tier = resolveExploreQualityTier(place);
    if (tier == null) continue;
    if (tier === 2) hasTier2 = true;
    if (tier === 3) hasTier3 = true;
    lowestTier = lowestTier == null ? tier : (Math.max(lowestTier, tier) as ExploreMapQualityTier);
  }
  return { lowestTier, hasTier2, hasTier3 };
}
