/**
 * Region Adjacency / Nearby Region — public API.
 *
 * Hierarchy gate (metro / living circle / admin) before travel-time ranking.
 * Separate tourist regions (箱根／伊勢／白濱…) are opt-in only.
 * Day policy: 1–3 none (default) / 4–5 max 1 / 6+ max 2–3.
 */
export type {
  NearbyDayPolicy,
  NearbyRegionCandidate,
  NearbyRegionResolveResult,
  NearbyRegionTier,
  ResolveNearbyRegionsOptions,
} from "@/lib/ai/region-adjacency/types";

export {
  NEARBY_DEFAULT_MAX_TRAVEL_MINUTES,
  NEARBY_LIVING_CIRCLE_MAX_MINUTES,
  estimateTravelMinutesFromKm,
  isNearbyRegionThemeTitle,
  resolveNearbyDayPolicy,
} from "@/lib/ai/region-adjacency/day-policy";

export {
  buildNearbyRegionComboPlaces,
  evaluateNearRegionHierarchy,
  isNearRegionHierarchyCompatible,
  isTooFarForDefaultNearby,
  listNearbyRegionVocabulary,
  resolveNearbyRegions,
} from "@/lib/ai/region-adjacency/resolve";

import {
  isNearbyRegionThemeTitle,
  resolveNearbyDayPolicy,
} from "@/lib/ai/region-adjacency/day-policy";
import { resolveNearbyRegions } from "@/lib/ai/region-adjacency/resolve";
import type { ResolveNearbyRegionsOptions } from "@/lib/ai/region-adjacency/types";

const NEARBY_COMBO_TITLE = "近郊備案";

type ThemeLike = { title: string; places: string[] };

/**
 * Apply nearby-region policy onto combination themes:
 * - Replace 「近郊備案」 places with adjacency-resolved regions
 * - Drop nearby-region themes when day policy says not to suggest
 */
export function applyNearbyRegionPolicyToThemes<T extends ThemeLike>(
  destination: string,
  themes: T[],
  opts: ResolveNearbyRegionsOptions = {},
): T[] {
  const dayPolicy = resolveNearbyDayPolicy(opts.tripDays);
  const resolved = resolveNearbyRegions(destination, opts);
  const nearbyPlaces = resolved.candidates.map((c) => c.label);

  const out: T[] = [];
  let injected = false;

  for (const theme of themes) {
    if (!isNearbyRegionThemeTitle(theme.title)) {
      out.push(theme);
      continue;
    }

    if (!dayPolicy.suggestNearbyByDefault && !opts.forceInclude) {
      continue;
    }

    if (nearbyPlaces.length === 0) {
      // No safe nearby regions — drop legacy far lists (伊勢 / 合掌造…).
      continue;
    }

    injected = true;
    out.push({
      ...theme,
      title: isNearbyRegionThemeTitle(theme.title)
        ? theme.title
        : NEARBY_COMBO_TITLE,
      places: nearbyPlaces,
    });
  }

  if (
    !injected &&
    dayPolicy.suggestNearbyByDefault &&
    nearbyPlaces.length >= 2
  ) {
    out.push({
      title: NEARBY_COMBO_TITLE,
      places: nearbyPlaces,
    } as T);
  }

  return out;
}

/**
 * Filter combination list (title+places) with the same nearby policy.
 */
export function applyNearbyRegionPolicyToCombinations<T extends ThemeLike>(
  destination: string,
  combos: T[],
  opts: ResolveNearbyRegionsOptions = {},
): T[] {
  return applyNearbyRegionPolicyToThemes(destination, combos, opts);
}
