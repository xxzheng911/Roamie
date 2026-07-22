/**
 * Region Hierarchy gate for Near Region.
 *
 * Travel time alone is insufficient. Default nearby requires sharing:
 *   1) adjacent / same admin area, OR
 *   2) same living circle, OR
 *   3) same metropolitan area
 *
 * Separate major tourist regions / different metros are excluded by default
 * even when transit minutes look acceptable.
 */
import type { RegionNode } from "@/lib/ai/region-adjacency/graph";

export type HierarchyCompatibility = {
  compatible: boolean;
  reason: string;
  shared?: "metro" | "living_circle" | "admin";
};

/**
 * Whether `other` may be treated as default Near Region of `primary`.
 * When `allowSeparateTouristRegion` is true (user / deep travel / confirm),
 * hierarchy still prefers same country but does not block separate zones.
 */
export function evaluateNearRegionHierarchy(
  primary: RegionNode,
  other: RegionNode,
  opts: { allowSeparateTouristRegion?: boolean } = {},
): HierarchyCompatibility {
  if (primary.id === other.id) {
    return { compatible: false, reason: "same_region" };
  }
  if (primary.countryCode !== other.countryCode) {
    return { compatible: false, reason: "different_country" };
  }

  const allowSeparate = Boolean(opts.allowSeparateTouristRegion);
  const ph = primary.hierarchy;
  const oh = other.hierarchy;

  if (!allowSeparate && oh.separateTouristRegion) {
    return {
      compatible: false,
      reason: "separate_tourist_region",
    };
  }

  if (
    !allowSeparate &&
    ph.touristZone &&
    oh.touristZone &&
    ph.touristZone !== oh.touristZone &&
    (oh.separateTouristRegion || ph.separateTouristRegion)
  ) {
    return {
      compatible: false,
      reason: "different_tourist_zone",
    };
  }

  if (ph.metroArea && oh.metroArea && ph.metroArea === oh.metroArea) {
    return { compatible: true, reason: "same_metro", shared: "metro" };
  }

  if (
    ph.livingCircle &&
    oh.livingCircle &&
    ph.livingCircle === oh.livingCircle
  ) {
    return {
      compatible: true,
      reason: "same_living_circle",
      shared: "living_circle",
    };
  }

  if (
    primary.adminArea &&
    other.adminArea &&
    primary.adminArea === other.adminArea
  ) {
    // Same admin alone is not enough when the other is a separate tourist region
    // (e.g. 神奈川県: 橫濱 OK via metro; 箱根 blocked above).
    return { compatible: true, reason: "same_admin", shared: "admin" };
  }

  if (allowSeparate) {
    return {
      compatible: true,
      reason: "allow_separate_tourist_region",
    };
  }

  return {
    compatible: false,
    reason: "different_metro_or_living_circle",
  };
}

export function isNearRegionHierarchyCompatible(
  primary: RegionNode,
  other: RegionNode,
  opts: { allowSeparateTouristRegion?: boolean } = {},
): boolean {
  return evaluateNearRegionHierarchy(primary, other, opts).compatible;
}
