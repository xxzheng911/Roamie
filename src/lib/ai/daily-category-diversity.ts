/**
 * Daily Category Diversity — prevent stacking same low-value types on one day.
 * Destination-agnostic; used by Planner day assembly + validator delivery gate.
 */
import type { PlaceResult } from "@/lib/place-result";
import { isTourismLandmarkException } from "@/lib/ai/tourism-quality-gate";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import {
  resolvePlaceCategoryFamily,
  type PlaceCategoryFamily,
} from "@/lib/ai/place-category-family";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export type DailyDiversityCategory =
  | "park_family"
  | "wildlife_family"
  | "market_family"
  | "cafe"
  | "viewpoint_family"
  | "shrine_temple"
  | "museum_family"
  | "restaurant"
  | "shopping"
  | "nightlife"
  | "monument"
  | "attraction"
  | "other";

export type DailyDiversityLimits = {
  park_family: number;
  wildlife_family: number;
  market_family: number;
  cafe: number;
  viewpoint_family: number;
  shrine_temple: number;
  museum_family: number;
  shopping: number;
  monument: number;
};

const DEFAULT_LIMITS: DailyDiversityLimits = {
  park_family: 1,
  wildlife_family: 1,
  market_family: 1,
  cafe: 1,
  viewpoint_family: 1,
  shrine_temple: 2,
  /** museum + gallery combined via classify → museum */
  museum_family: 1,
  shopping: 1,
  monument: 0,
};

function placeBlob(place: PlaceResult): string {
  return [place.name, place.address, place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function placeTypes(place: PlaceResult): Set<string> {
  const out = new Set<string>();
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  return out;
}

export function resolveDailyDiversityLimits(opts?: {
  style?: TripStyleKey;
  userText?: string;
}): DailyDiversityLimits {
  const limits = { ...DEFAULT_LIMITS };
  const text = (opts?.userText ?? "").toLowerCase();
  const style = opts?.style;

  if (/神社|寺廟|寺庙|寺|廟|文化宗教|深度文化|temple|shrine|spiritual/i.test(text)) {
    limits.shrine_temple = 4;
  }
  if (/咖啡|咖啡廳|cafe\s*hop|咖啡主題|咖啡巡/i.test(text)) {
    limits.cafe = 3;
  }
  if (
    (style === "slow_nature" || /公園|戶外|户外|nature|hiking|綠地/i.test(text)) &&
    /公園|nature|戶外|户外/.test(text + (style ?? ""))
  ) {
    limits.park_family = 1;
  }
  if (/夜市|市場巡|逛市場|market\s*hop/i.test(text)) {
    limits.market_family = 1;
  }
  if (/博物館巡|美術館|藝術之旅|museum\s*hop|art\s*tour|museum\s*day/i.test(text)) {
    limits.museum_family = 2;
  }
  if (/宗教文化|temple\s*tour|shrine\s*hop/i.test(text)) {
    limits.shrine_temple = 4;
  }
  return limits;
}

/** @deprecated prefer resolvePlaceCategoryFamily — kept for diversity limit keys */
export function classifyDailyDiversityCategory(place: PlaceResult): DailyDiversityCategory {
  const family = resolvePlaceCategoryFamily(place);
  return diversityCategoryFromFamily(family, place);
}

export function diversityCategoryFromFamily(
  family: PlaceCategoryFamily,
  place: PlaceResult,
): DailyDiversityCategory {
  const types = placeTypes(place);
  const blob = placeBlob(place);
  const landmark = isTourismLandmarkException(place);

  if (family === "museum_family") return "museum_family";
  if (family === "viewpoint_family") return "viewpoint_family";
  if (family === "wildlife_family") return "wildlife_family";
  if (family === "temple_shrine" || family === "church") return "shrine_temple";
  if (family === "cafe") return "cafe";
  if (family === "nightlife") return "nightlife";
  if (family === "shopping") return "shopping";
  if (family === "restaurant") return "restaurant";
  if (family === "monument") {
    return landmark ? "attraction" : "monument";
  }
  if (family === "market_family") return "market_family";
  if (family === "park_family") return "park_family";

  if (
    /塔|タワー|tower|觀景|展望|observation|電視塔|テレビ塔|通天閣|skytree|鐵塔|viewing\s*mound|sunset\s*hill|viewpoint|lookout|觀景丘|夕陽丘/i.test(
      blob,
    ) ||
    types.has("observation_deck")
  ) {
    return "viewpoint_family";
  }

  if (
    types.has("place_of_worship") ||
    types.has("hindu_temple") ||
    types.has("church") ||
    types.has("mosque") ||
    types.has("synagogue") ||
    /神社|寺廟|寺庙|寺$|廟|神宮|寺院|temple|shrine/i.test(blob)
  ) {
    return "shrine_temple";
  }

  if (
    types.has("museum") ||
    types.has("art_gallery") ||
    types.has("history_museum") ||
    types.has("art_museum") ||
    types.has("science_museum") ||
    types.has("military_museum") ||
    /博物|美術館|gallery|museum|紀念館|軍區/i.test(blob)
  ) {
    return "museum_family";
  }

  if (types.has("cafe") || types.has("coffee_shop") || /咖啡|カフェ|cafe|coffee/i.test(blob)) {
    return "cafe";
  }

  if (
    types.has("night_club") ||
    types.has("bar") ||
    /酒吧|bar|夜店|nightlife|클럽/i.test(blob)
  ) {
    return "nightlife";
  }

  if (
    /夜市|觀光市場|観光市場|traditional\s*market|築地|豊洲|東大門|南大門|廣藏/i.test(blob) ||
    (types.has("market") && landmark)
  ) {
    return "market_family";
  }

  if (types.has("market") || (/市場|market/i.test(blob) && !landmark)) {
    return "market_family";
  }

  if (types.has("park") || /公園|park/i.test(blob)) {
    return "park_family";
  }

  if (
    types.has("shopping_mall") ||
    types.has("department_store") ||
    /購物|商场|商场|shopping|mall|百貨/i.test(blob)
  ) {
    return "shopping";
  }

  if (
    types.has("restaurant") ||
    types.has("food") ||
    types.has("meal_takeaway") ||
    /餐|料理|restaurant|dining/i.test(blob)
  ) {
    return "restaurant";
  }

  if (types.has("tourist_attraction") || types.has("landmark")) return "attraction";
  return "other";
}

export type DailyDiversityCheck = {
  ok: boolean;
  category: DailyDiversityCategory;
  count: number;
  limit: number;
  reason?: string;
};

/**
 * Would adding `place` violate per-day diversity caps?
 */
export function wouldViolateDailyDiversity(
  existing: PlaceResult[],
  place: PlaceResult,
  limits?: DailyDiversityLimits,
): DailyDiversityCheck {
  const caps = limits ?? DEFAULT_LIMITS;
  const category = classifyDailyDiversityCategory(place);
  const count = existing.filter((p) => classifyDailyDiversityCategory(p) === category).length;
  const limit =
    category in caps
      ? caps[category as keyof DailyDiversityLimits]
      : Number.POSITIVE_INFINITY;

  if (Number.isFinite(limit) && count >= limit) {
    return {
      ok: false,
      category,
      count,
      limit,
      reason: `daily_${category}_cap:${count}>=${limit}`,
    };
  }
  return { ok: true, category, count, limit };
}

/**
 * Filter a day's candidate list to respect diversity caps (keeps first eligible).
 */
export function applyDailyCategoryDiversity(
  places: PlaceResult[],
  opts?: { style?: TripStyleKey; userText?: string },
): { kept: PlaceResult[]; dropped: number; conflictCategories: string[] } {
  const limits = resolveDailyDiversityLimits(opts);
  const kept: PlaceResult[] = [];
  const conflictCategories = new Set<string>();
  let dropped = 0;

  for (const place of places) {
    const check = wouldViolateDailyDiversity(kept, place, limits);
    if (!check.ok) {
      dropped += 1;
      conflictCategories.add(check.category);
      continue;
    }
    kept.push(place);
  }

  return {
    kept,
    dropped,
    conflictCategories: [...conflictCategories],
  };
}

/** Delivery-gate summary for one day (hard when violations present). */
export function summarizeDailyCategoryDiversity(
  day: number,
  places: PlaceResult[],
  opts?: { style?: TripStyleKey; userText?: string; overrideReason?: string },
): {
  day: number;
  categoryCounts: Record<string, number>;
  categoryLimits: DailyDiversityLimits;
  violations: string[];
  overrideReason?: string;
  gatePass: boolean;
} {
  const limits = resolveDailyDiversityLimits(opts);
  const categoryCounts: Record<string, number> = {};
  for (const place of places) {
    const cat = classifyDailyDiversityCategory(place);
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
  }
  const violations: string[] = [];
  for (const [cat, count] of Object.entries(categoryCounts)) {
    const limit =
      cat in limits
        ? limits[cat as keyof DailyDiversityLimits]
        : Number.POSITIVE_INFINITY;
    if (Number.isFinite(limit) && count > limit) {
      violations.push(`${cat}:${count}>${limit}`);
    }
  }
  const gatePass = violations.length === 0 || Boolean(opts?.overrideReason);
  if (!gatePass) {
    const seen: Record<string, number> = {};
    for (const place of places) {
      const categoryFamily = classifyDailyDiversityCategory(place);
      seen[categoryFamily] = (seen[categoryFamily] ?? 0) + 1;
      const limit =
        categoryFamily in limits
          ? limits[categoryFamily as keyof DailyDiversityLimits]
          : Number.POSITIVE_INFINITY;
      if (Number.isFinite(limit) && seen[categoryFamily] > limit) {
        logAiPipeline(
          "[DAILY_CATEGORY_HARD_GATE]",
          `day=${day}`,
          `placeId=${place.id}`,
          `placeName=${place.localizedDisplayName ?? place.name}`,
          `rawType=${place.primaryType ?? place.types?.[0] ?? ""}`,
          `categoryFamily=${categoryFamily}`,
          `currentCount=${seen[categoryFamily]}`,
          `limit=${limit}`,
          "action=replan_or_replace",
          "replacementPlaceId=",
          "replacementCategoryFamily=",
        );
      }
    }
  }
  logAiPipeline(
    "[DAILY_CATEGORY_DIVERSITY_SUMMARY]",
    `day=${day}`,
    `categoryCounts=${JSON.stringify(categoryCounts)}`,
    `categoryLimits=${JSON.stringify(limits)}`,
    `violations=${violations.join("|") || "-"}`,
    `overrideReason=${opts?.overrideReason ?? ""}`,
    `gatePass=${gatePass}`,
  );
  return {
    day,
    categoryCounts,
    categoryLimits: limits,
    violations,
    overrideReason: opts?.overrideReason,
    gatePass,
  };
}
