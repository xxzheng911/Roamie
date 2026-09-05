/**
 * Quality Gate — drop garbage before diversity / Planner.
 * Destination-agnostic; reuses shared retail / burial / low-value filters.
 */
import type { PlaceResult } from "@/lib/place-result";
import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import {
  filterExcludedRetailPlaces,
  getExcludedRetailReason,
  isExcludedRetailPlace,
  isLowValuePlanningPlace,
} from "@/lib/ai/ai-day-plan-slot-rules";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import type { QualityRejectReason } from "@/lib/ai/candidate-pool/types";
import { evaluateTourismQuality } from "@/lib/ai/tourism-quality-gate";
import { isPlaceOperationalForRecommendation } from "@/lib/place-operational-eligibility";

/** Soft popularity floor — stricter than nothing, softer than legacy 4.0/100 */
const MIN_RATING = 3.8;
const MIN_REVIEWS = 25;
/** Absolute floor when rating present */
const HARD_MIN_RATING = 3.2;
const HARD_MIN_REVIEWS = 5;

const LARGE_CHAIN_RE =
  /麥當勞|肯德基|摩斯|subway|漢堡王|burger\s*king|必勝客|達美樂|kfc|mcdonald|星巴克|starbucks|路易莎|louisa|\bcama\b|85度c|50嵐|清心|迷客夏|可不可|\bcoco\b|七十一|7-eleven|familymart|全家|萊爾富|全聯|家樂福|costco|ikea|三商巧福|丸亀|築間|石二鍋|yoshinoya|吉野家|すき家|sukiya|松屋|gusto|サイゼ|saizeriya|dennys|denny'?s|coco\s*ichibanya|coCo壱|一蘭|一風堂|ippudo/i;

const RESIDENTIAL_TYPES = new Set([
  "premise",
  "subpremise",
  "street_address",
  "route",
  "intersection",
  "plus_code",
  "neighborhood",
  "political",
  "locality",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "country",
  "postal_code",
  "floor",
  "room",
]);

const OFFICE_TYPES = new Set([
  "corporate_office",
  "local_government_office",
  "accounting",
  "lawyer",
  "real_estate_agency",
  "insurance_agency",
  "finance",
  "bank",
  "atm",
]);

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

function isResidentialPlace(place: PlaceResult): boolean {
  const types = placeTypes(place);
  const meaningful = [...types].filter((t) => !RESIDENTIAL_TYPES.has(t));
  // Pure geo / address entities
  if (types.size > 0 && meaningful.length === 0) return true;
  if (types.has("premise") && meaningful.length === 0) return true;
  return /住宅|公寓|community\s*center|私人|private\s*residence|宿舍/.test(
    placeBlob(place),
  );
}

function isOfficePlace(place: PlaceResult): boolean {
  const types = placeTypes(place);
  if ([...OFFICE_TYPES].some((t) => types.has(t))) return true;
  return /辦公|办公|office\s*building|corporate\s*office|市政府|區公所/.test(
    placeBlob(place),
  );
}

function brandKey(place: PlaceResult): string {
  const name = (place.name ?? "").trim().toLowerCase();
  // Strip common branch suffixes (…店 / store / 支店)
  return name
    .replace(/[(（].*?[)）]/g, "")
    .replace(/\s*(分店|本店|支店|店|store|outlet)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function qualityRejectReason(
  place: PlaceResult,
  opts?: { style?: TripStyleKey; userText?: string; seenBrands?: Set<string> },
): QualityRejectReason | null {
  if (!place.name?.trim() || !place.id?.trim()) return "missing_identity";
  if (!isPlaceOperationalForRecommendation(place)) return "permanently_closed";
  if (isBurialOrFuneralPlace(place)) return "burial";

  // Unified Tourism Quality Gate (drinking fountains, city halls, ordinary parks…)
  const tourism = evaluateTourismQuality(place);
  if (!tourism.ok) return "low_value";

  if (isExcludedRetailPlace(place, opts)) {
    const reason = getExcludedRetailReason(place, opts);
    if (reason === "hypermarket") return "hypermarket";
    return "supermarket";
  }
  if (isLowValuePlanningPlace(place)) return "low_value";
  if (isOfficePlace(place)) return "office";
  if (isResidentialPlace(place)) return "residential";
  if (LARGE_CHAIN_RE.test(placeBlob(place))) return "large_chain";

  const brand = brandKey(place);
  if (brand && opts?.seenBrands?.has(brand)) return "duplicate_brand";

  const rating = place.rating;
  const reviews = place.userRatingCount;
  const hasRating = rating != null && Number.isFinite(rating);
  const hasReviews = reviews != null && Number.isFinite(reviews);

  if (hasRating && rating! < HARD_MIN_RATING) return "low_rating";
  if (hasReviews && reviews! < HARD_MIN_REVIEWS) return "few_reviews";

  // Popularity: need either enough reviews or solid rating+reviews pair
  if (hasRating && hasReviews) {
    if (rating! < MIN_RATING && reviews! < MIN_REVIEWS) return "not_popular";
    if (reviews! < MIN_REVIEWS && rating! < 4.2) return "few_reviews";
  } else if (hasReviews && reviews! < HARD_MIN_REVIEWS) {
    return "few_reviews";
  }

  return null;
}

export function applyQualityGate(
  places: PlaceResult[],
  opts?: {
    style?: TripStyleKey;
    userText?: string;
    protectPlaceIds?: ReadonlySet<string> | readonly string[];
    protectPlaceNames?: readonly string[];
  },
): { kept: PlaceResult[]; rejected: number; reasons: Record<string, number> } {
  const retailFirst = filterExcludedRetailPlaces(places, opts);
  const seenBrands = new Set<string>();
  const kept: PlaceResult[] = [];
  const reasons: Record<string, number> = {};
  let rejected = places.length - retailFirst.length;
  if (rejected > 0) reasons.supermarket = (reasons.supermarket ?? 0) + rejected;

  const protectIds = new Set(
    (opts?.protectPlaceIds ? [...opts.protectPlaceIds] : [])
      .map((id) => String(id).trim())
      .filter(Boolean),
  );
  const protectNames = (opts?.protectPlaceNames ?? [])
    .map((n) => n.trim().replace(/\s+/g, "").toLowerCase())
    .filter(Boolean);
  const isProtected = (place: PlaceResult): boolean => {
    const id = (place.id ?? "").trim();
    if (id && protectIds.has(id)) return true;
    const key = (place.name ?? "").trim().replace(/\s+/g, "").toLowerCase();
    if (!key) return false;
    return protectNames.some((n) => key === n || key.includes(n) || n.includes(key));
  };

  for (const place of retailFirst) {
    if (isProtected(place)) {
      const brand = brandKey(place);
      if (brand) seenBrands.add(brand);
      kept.push(place);
      continue;
    }
    const reason = qualityRejectReason(place, { ...opts, seenBrands });
    if (reason) {
      rejected += 1;
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      continue;
    }
    const brand = brandKey(place);
    if (brand) seenBrands.add(brand);
    kept.push(place);
  }

  logAiPipeline(
    "[CANDIDATE_POOL_QUALITY]",
    `in=${places.length}`,
    `kept=${kept.length}`,
    `rejected=${rejected}`,
    `reasons=${Object.entries(reasons)
      .map(([k, n]) => `${k}:${n}`)
      .join("|") || "none"}`,
  );

  return { kept, rejected, reasons };
}
