/**
 * Single-shot itinerary quality summary log.
 * Device tests default to summary only — no per-place reject spam.
 */
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { PlaceResult } from "@/lib/place-result";
import {
  applyTourismQualityGate,
  evaluateTourismQuality,
} from "@/lib/ai/tourism-quality-gate";
import {
  applyDailyCategoryDiversity,
  classifyDailyDiversityCategory,
} from "@/lib/ai/daily-category-diversity";
import { resolvePlaceDisplayName } from "@/lib/place-display-name";
import { distanceMeters } from "@/lib/geo-distance";
import type { TransitLegAdvice } from "@/lib/transit/types";

type DayPlanEntry = {
  time: string;
  label: string;
  name: string;
  place: PlaceResult;
};

type ComposedDayPlan = {
  day: number;
  entries: DayPlanEntry[];
  isIncomplete?: boolean;
};

export type ItineraryQualitySummary = {
  destination: string;
  days: number;
  totalStops: number;
  excludedLowValueCount: number;
  localizedNameFallbackCount: number;
  duplicateCount: number;
  categoryConflictDays: number;
  geoClusterConflictDays: number;
  routeConflictLegs: number;
  transportModeMismatchCount: number;
  qualityPass: boolean;
};

const LONG_LEG_WARN_M = 12_000;
const GEO_SPAN_CONFLICT_M = 25_000;

function countDuplicates(plans: ComposedDayPlan[]): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (const plan of plans) {
    for (const entry of plan.entries) {
      const id = (entry.place.id ?? entry.name).trim().toLowerCase();
      if (!id) continue;
      if (seen.has(id)) dupes += 1;
      else seen.add(id);
    }
  }
  return dupes;
}

function countCategoryConflictDays(plans: ComposedDayPlan[]): number {
  let days = 0;
  for (const plan of plans) {
    const places = plan.entries.map((e) => e.place);
    const { conflictCategories } = applyDailyCategoryDiversity(places);
    // Re-check: if current day already violates caps, count it
    const counts = new Map<string, number>();
    let conflict = false;
    for (const place of places) {
      const cat = classifyDailyDiversityCategory(place);
      const n = (counts.get(cat) ?? 0) + 1;
      counts.set(cat, n);
      if (
        (cat === "ordinary_park" && n > 0) ||
        (cat === "ordinary_market" && n > 0) ||
        (cat === "cafe" && n > 1) ||
        (cat === "viewpoint_tower" && n > 1) ||
        (cat === "landmark_park" && n > 1) ||
        (cat === "tourist_market" && n > 1) ||
        (cat === "shrine_temple" && n > 2)
      ) {
        conflict = true;
      }
    }
    if (conflict || conflictCategories.length > 0) days += 1;
  }
  return days;
}

function countGeoClusterConflictDays(plans: ComposedDayPlan[]): number {
  let days = 0;
  for (const plan of plans) {
    const coords = plan.entries
      .map((e) =>
        e.place.lat != null && e.place.lng != null
          ? { lat: e.place.lat, lng: e.place.lng }
          : null,
      )
      .filter((c): c is { lat: number; lng: number } => c != null);
    if (coords.length < 2) continue;
    let maxSpan = 0;
    for (let i = 0; i < coords.length; i++) {
      for (let j = i + 1; j < coords.length; j++) {
        maxSpan = Math.max(maxSpan, distanceMeters(coords[i]!, coords[j]!));
      }
    }
    if (maxSpan > GEO_SPAN_CONFLICT_M) days += 1;
  }
  return days;
}

function countRouteConflictLegs(plans: ComposedDayPlan[]): number {
  let legs = 0;
  for (const plan of plans) {
    for (let i = 1; i < plan.entries.length; i++) {
      const a = plan.entries[i - 1]!.place;
      const b = plan.entries[i]!.place;
      if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) continue;
      if (distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) > LONG_LEG_WARN_M) {
        legs += 1;
      }
    }
  }
  return legs;
}

function countTransportModeMismatches(
  transitLegs: Record<string, TransitLegAdvice> | undefined,
): number {
  if (!transitLegs) return 0;
  let n = 0;
  for (const leg of Object.values(transitLegs)) {
    if (!leg.requestedMode || !leg.resolvedMode) continue;
    if (leg.requestedMode === leg.resolvedMode) continue;
    // Mismatch only counts when UI would still show requested (legacy bug).
    // With SoT fixed, count only when display text contradicts resolvedMode.
    const text = leg.transportDisplayText ?? "";
    const resolved = leg.resolvedMode;
    if (resolved === "TRANSIT" && text && !/大眾運輸/.test(text) && !/查看路線|無法/.test(text)) {
      n += 1;
    } else if (
      (resolved === "DRIVE" || resolved === "TWO_WHEELER") &&
      text &&
      !/開車|自駕|租車|計程車/.test(text) &&
      !/查看路線|無法/.test(text)
    ) {
      n += 1;
    } else if (
      resolved === "WALK" &&
      text &&
      !/步行|走路/.test(text) &&
      !/查看路線|無法|開車|大眾/.test(text)
    ) {
      n += 1;
    }
  }
  return n;
}

function countLocalizedNameFallbacks(plans: ComposedDayPlan[]): number {
  let n = 0;
  for (const plan of plans) {
    for (const entry of plan.entries) {
      const resolved = resolvePlaceDisplayName(entry.place.name ?? entry.name, "zh-TW");
      if (
        resolved.localizationSource === "english" ||
        resolved.localizationSource === "english_fallback" ||
        resolved.localizationSource === "original" ||
        resolved.localizationSource === "raw_name"
      ) {
        n += 1;
      }
    }
  }
  return n;
}

export function buildItineraryQualitySummary(params: {
  destination: string;
  days: number;
  plans: ComposedDayPlan[];
  /** Candidates rejected before planning (optional) */
  excludedLowValueCount?: number;
  transitLegs?: Record<string, TransitLegAdvice>;
  /** Pre-gate pool to measure exclusions */
  candidatePool?: PlaceResult[];
}): ItineraryQualitySummary {
  const { destination, days, plans, transitLegs, candidatePool } = params;

  let excludedLowValueCount = params.excludedLowValueCount ?? 0;
  if (candidatePool?.length) {
    const gate = applyTourismQualityGate(candidatePool, { source: "quality_summary" });
    excludedLowValueCount = gate.excludedLowValueCount;
  } else {
    // Count low-value stops that slipped into the delivered plan
    for (const plan of plans) {
      for (const entry of plan.entries) {
        if (!evaluateTourismQuality(entry.place).ok) excludedLowValueCount += 1;
      }
    }
  }

  const duplicateCount = countDuplicates(plans);
  const categoryConflictDays = countCategoryConflictDays(plans);
  const geoClusterConflictDays = countGeoClusterConflictDays(plans);
  const routeConflictLegs = countRouteConflictLegs(plans);
  const transportModeMismatchCount = countTransportModeMismatches(transitLegs);
  const localizedNameFallbackCount = countLocalizedNameFallbacks(plans);
  const totalStops = plans.reduce((n, p) => n + p.entries.length, 0);

  const qualityPass =
    excludedLowValueCount === 0 &&
    duplicateCount === 0 &&
    categoryConflictDays === 0 &&
    geoClusterConflictDays === 0 &&
    transportModeMismatchCount === 0 &&
    routeConflictLegs <= Math.max(1, Math.floor(days * 0.5));

  return {
    destination,
    days,
    totalStops,
    excludedLowValueCount,
    localizedNameFallbackCount,
    duplicateCount,
    categoryConflictDays,
    geoClusterConflictDays,
    routeConflictLegs,
    transportModeMismatchCount,
    qualityPass,
  };
}

export function logItineraryQualitySummary(summary: ItineraryQualitySummary): void {
  logAiPipeline(
    "[ITINERARY_QUALITY_SUMMARY]",
    `destination=${summary.destination}`,
    `days=${summary.days}`,
    `totalStops=${summary.totalStops}`,
    `excludedLowValueCount=${summary.excludedLowValueCount}`,
    `localizedNameFallbackCount=${summary.localizedNameFallbackCount}`,
    `duplicateCount=${summary.duplicateCount}`,
    `categoryConflictDays=${summary.categoryConflictDays}`,
    `geoClusterConflictDays=${summary.geoClusterConflictDays}`,
    `routeConflictLegs=${summary.routeConflictLegs}`,
    `transportModeMismatchCount=${summary.transportModeMismatchCount}`,
    `qualityPass=${summary.qualityPass}`,
  );
}
