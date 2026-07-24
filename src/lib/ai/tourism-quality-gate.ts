/**
 * Tourism Quality Gate — unified filter before Planner / Candidate Pool.
 * Destination-agnostic: exclude low-value public facilities while preserving
 * genuine high-popularity tourist landmarks (例外保留).
 */
import type { PlaceResult } from "@/lib/place-result";
import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export type TourismQualityRejectReason =
  | "excluded_type"
  | "excluded_name_keyword"
  | "low_value_facility"
  | "zero_reviews"
  | "zero_rating"
  | "burial"
  | "transit_station"
  | "missing_identity";

export type TourismQualityDecision = {
  ok: boolean;
  reason?: TourismQualityRejectReason;
  detail?: string;
  /** Kept despite keyword hit because landmark exception matched */
  landmarkException?: boolean;
};

/** Google / internal types that are never tourism stops by default. */
const EXCLUDED_TYPES = new Set([
  "drinking_water",
  "water_fountain",
  "public_drinking_station",
  "torch",
  "olympic_cauldron",
  "fire_monument",
  "clock",
  "clock_tower",
  "observation_structure_without_tourism_value",
  "government_office",
  "city_hall",
  "prefectural_office",
  "district_office",
  "municipal_building",
  "administrative_building",
  "public_office",
  "local_government_office",
  "city_hall",
  "courthouse",
  "ordinary_park",
  "neighborhood_park",
  "small_urban_park",
  "generic_market",
  "ordinary_market",
  "wholesale_market",
  "supermarket",
  "grocery_store",
  "grocery_or_supermarket",
  "convenience_store",
  "shopping_mall_without_tourism_value",
  "bus_station",
  "bus_stop",
  "train_station",
  "subway_station",
  "transit_station",
  "light_rail_station",
  "parking",
  "parking_lot",
  "rest_area",
  "public_toilet",
  "toilet",
  "bridge_marker",
  "memorial_marker",
  "monument_without_tourism_value",
  "street",
  "route",
  "road",
  "pedestrian_street_without_verified_attraction_value",
  "residential_area",
  "apartment",
  "premise",
  "subpremise",
  "street_address",
  "intersection",
  "plus_code",
  "office_building",
  "corporate_office",
  "school",
  "primary_school",
  "secondary_school",
  "university",
  "hospital",
  "cemetery",
  "grave",
  "funeral_home",
  "shrine_subspot",
  "temple_subspot",
  "internal_landmark",
  "zero_review_place",
  "zero_rating_place",
  "virtual_place",
  "atm",
  "bank",
  "gas_station",
  "police",
  "fire_station",
  "post_office",
  "beverage_store",
  "juice_shop",
  "internal_fountain",
  "lawn_area",
]);

/**
 * Name keywords that usually indicate low-value / non-tourist spots.
 * Famous landmarks can still pass via landmarkException().
 */
const EXCLUDED_NAME_RE =
  /飲水|飲水處|水飲み|水飲み場|聖火台|時計台|電視塔|テレビ塔|市役所|區役所|区役所|道廳|道庁|廳舍|庁舎|政府大樓|行政大樓|辦公廳|公所|停車場|トイレ|廁所|公衆便所|道路|街道|入口|橋跡|記念碑|紀念碑|近鄰公園|近隣公園|一般草地|普通噴泉|飲料店|neighborhood\s*park|(?:lawn|grass)\s*area|(?:crystal\s*)?fountain|beverage\s*(?:shop|store)?|drinking\s*fountain|water\s*fountain|olympic\s*cauldron|city\s*hall|prefectur|municipal\s*office/i;

/** Soft park / market / plaza keywords — exclude unless landmark exception. */
const SOFT_LOW_VALUE_NAME_RE =
  /(?<!國立|国立|中央|都會|都会|森林|海洋|主題|国立公園|國家公園|国営)公園|(?<!夜|觀光|観光|傳統|传统|魚|花|土產|土産)市場|(?<!市政|市民|自由|和平|廣場飯店)廣場|(?<!市政|市民|自由|和平)広場/i;

const TOURISM_SIGNAL_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "zoo",
  "aquarium",
  "amusement_park",
  "historical_landmark",
  "cultural_landmark",
  "place_of_worship",
  "church",
  "hindu_temple",
  "mosque",
  "synagogue",
  "landmark",
  "natural_feature",
  "park",
  "night_club",
  "stadium",
]);

/** Well-known landmark name patterns that may contain otherwise-excluded keywords. */
const FAMOUS_LANDMARK_NAME_RE =
  /東京塔|東京タワー|tokyo\s*tower|通天閣|tsutenkaku|京都塔|京都タワー|札幌電視塔|札幌テレビ塔|首爾塔|南山塔|n\s*seoul\s*tower|艾菲爾|艾菲爾鐵塔|eiffel|自由女神|statue\s*of\s*liberty|大本鐘|big\s*ben|倫敦眼|london\s*eye|東方明珠|台北101|tai\s*pei\s*101|台北\s*101|陽光六十|sunshine\s*60|通天閣|天空樹|スカイツリー|skytree|淺草寺|浅草寺|明治神宮|金閣寺|清水寺|嚴島|严岛|奈良公園|上野公園|代代木公園|yoyogi|中央公園|central\s*park|海德公園|hyde\s*park|築地市場|築地|toyosu|豊洲|東大門|明洞|弘大|景福宮|昌德宮|德壽宮|鐘路|광장시장|廣藏市場|남대문|南大門市場|동대문|東大門市場|札幌時計台|時計台(?=.*札幌)|sapporo\s*clock| bell\s*tower|大鐘樓/i;

const LANDMARK_MIN_RATING = 4.0;
const LANDMARK_MIN_REVIEWS = 200;
const HARD_ZERO_REVIEWS = 0;
const HARD_ZERO_RATING = 0;

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

function placeBlob(place: PlaceResult): string {
  return [place.name, place.address, place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ");
}

function hasTourismType(types: Set<string>): boolean {
  return [...types].some((t) => TOURISM_SIGNAL_TYPES.has(t));
}

/**
 * Exception: keep a keyword-hit place only when it is a genuine tourist landmark.
 * Requires tourism type + popularity + (famous name OR strong review floor).
 */
export function isTourismLandmarkException(place: PlaceResult): boolean {
  const types = placeTypes(place);
  const name = (place.name ?? "").trim();
  if (!name) return false;
  if (!hasTourismType(types) && !types.has("point_of_interest")) return false;

  const rating = place.rating;
  const reviews = place.userRatingCount ?? 0;
  const popular =
    rating != null &&
    Number.isFinite(rating) &&
    rating >= LANDMARK_MIN_RATING &&
    reviews >= LANDMARK_MIN_REVIEWS;
  const famous = FAMOUS_LANDMARK_NAME_RE.test(name);

  // Famous name alone is not enough without tourism signal + some reviews.
  if (famous && hasTourismType(types) && reviews >= 50 && (rating == null || rating >= 3.8)) {
    return true;
  }
  if (popular && hasTourismType(types)) return true;
  return false;
}

function isHardExcludedType(types: Set<string>): string | null {
  for (const t of types) {
    if (EXCLUDED_TYPES.has(t)) return t;
  }
  return null;
}

function isOrdinaryParkOrMarket(place: PlaceResult, types: Set<string>): boolean {
  const name = (place.name ?? "").trim();
  const blob = placeBlob(place);

  // Parks: type=park without tourism signal / landmark exception → ordinary
  if (types.has("park") || /公園|park/i.test(name)) {
    if (isTourismLandmarkException(place)) return false;
    if (
      /國家公園|国営公園|国立公園|森林公園|海洋公園|主題公園|遊園地|amusement|national\s*park|central\s*park|yoyogi|上野公園|代代木|奈良公園/i.test(
        blob,
      )
    ) {
      return false;
    }
    // Neighborhood / generic urban parks
    if (
      /近鄰|近隣|街区|社區|社区|neighborhood|pocket\s*park|兒童公園|児童公園|小公園/i.test(blob) ||
      (!hasTourismType(types) && (place.userRatingCount ?? 0) < 80)
    ) {
      return true;
    }
  }

  // Markets: supermarket already in EXCLUDED_TYPES; soft ordinary markets
  if (types.has("market") || /市場|market/i.test(name)) {
    if (isTourismLandmarkException(place)) return false;
    if (/夜市|觀光|観光|traditional\s*market|魚市場|築地|豊洲|東大門|南大門|廣藏|광장/i.test(blob)) {
      return false;
    }
    if ((place.userRatingCount ?? 0) < 100 || !hasTourismType(types)) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluate one place for tourism itinerary eligibility.
 */
export function evaluateTourismQuality(place: PlaceResult): TourismQualityDecision {
  const name = (place.name ?? "").trim();
  const id = (place.id ?? "").trim();
  if (!name || !id) {
    return { ok: false, reason: "missing_identity" };
  }

  if (isBurialOrFuneralPlace(place)) {
    return { ok: false, reason: "burial" };
  }

  if (isForbiddenTransitAttraction(place)) {
    return { ok: false, reason: "transit_station" };
  }

  const types = placeTypes(place);
  // Ordinary lawns, fountains and beverage counters are sub-facilities, not
  // itinerary anchors. Popularity cannot promote these descriptive POIs.
  if (/(?:lawn|grass)\s*area|(?:crystal\s*)?fountain|beverage\s*(?:shop|store)?|一般草地|普通噴泉|飲料店/i.test(name)) {
    return { ok: false, reason: "low_value_facility", detail: "sub_facility" };
  }
  const hardType = isHardExcludedType(types);
  if (hardType) {
    // Some excluded types can still be famous landmarks (clock tower, TV tower, city hall).
    if (
      /clock|tower|city_hall|government|monument|park|market|observation/i.test(hardType) &&
      isTourismLandmarkException(place)
    ) {
      return { ok: true, landmarkException: true, detail: hardType };
    }
    // Absolute exclusions that never qualify as attractions
    if (
      /drinking_water|water_fountain|parking|toilet|school|hospital|cemetery|grave|atm|bank|gas_station|bus_stop|residential|apartment|office_building|corporate_office|supermarket|grocery|convenience_store|street_address|route|premise/i.test(
        hardType,
      )
    ) {
      return { ok: false, reason: "excluded_type", detail: hardType };
    }
    if (!isTourismLandmarkException(place)) {
      return { ok: false, reason: "excluded_type", detail: hardType };
    }
    return { ok: true, landmarkException: true, detail: hardType };
  }

  if (EXCLUDED_NAME_RE.test(name) || EXCLUDED_NAME_RE.test(placeBlob(place))) {
    if (isTourismLandmarkException(place)) {
      return { ok: true, landmarkException: true, detail: "name_keyword" };
    }
    return { ok: false, reason: "excluded_name_keyword", detail: name.slice(0, 80) };
  }

  if (SOFT_LOW_VALUE_NAME_RE.test(name) && !isTourismLandmarkException(place)) {
    if (isOrdinaryParkOrMarket(place, types)) {
      return { ok: false, reason: "low_value_facility", detail: "ordinary_park_or_market" };
    }
  }

  if (isOrdinaryParkOrMarket(place, types)) {
    return { ok: false, reason: "low_value_facility", detail: "ordinary_park_or_market" };
  }

  const reviews = place.userRatingCount;
  const rating = place.rating;
  if (reviews != null && Number.isFinite(reviews) && reviews <= HARD_ZERO_REVIEWS) {
    // Allow brand-new places with tourism type only if they look like real attractions
    if (!hasTourismType(types)) {
      return { ok: false, reason: "zero_reviews" };
    }
  }
  if (rating != null && Number.isFinite(rating) && rating <= HARD_ZERO_RATING) {
    return { ok: false, reason: "zero_rating" };
  }

  return { ok: true };
}

export function passesTourismQualityGate(place: PlaceResult): boolean {
  return evaluateTourismQuality(place).ok;
}

export type TourismQualityGateResult = {
  kept: PlaceResult[];
  rejected: Array<{ place: PlaceResult; reason: TourismQualityRejectReason; detail?: string }>;
  excludedLowValueCount: number;
};

let placeQualityRejectDebug = false;

/** Enable verbose [PLACE_QUALITY_REJECT] logs (default off for device tests). */
export function setPlaceQualityRejectDebug(enabled: boolean): void {
  placeQualityRejectDebug = enabled;
}

export function applyTourismQualityGate(
  places: PlaceResult[],
  opts?: {
    debugRejects?: boolean;
    source?: string;
    /** Locked selected places must never be quality-dropped. */
    protectPlaceIds?: ReadonlySet<string> | readonly string[];
    protectPlaceNames?: readonly string[];
  },
): TourismQualityGateResult {
  const debug = opts?.debugRejects ?? placeQualityRejectDebug;
  const kept: PlaceResult[] = [];
  const rejected: TourismQualityGateResult["rejected"] = [];
  const protectIds = new Set(
    (opts?.protectPlaceIds
      ? [...opts.protectPlaceIds]
      : []
    )
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

  for (const place of places) {
    if (isProtected(place)) {
      kept.push(place);
      continue;
    }
    const decision = evaluateTourismQuality(place);
    if (decision.ok) {
      kept.push(place);
      continue;
    }
    rejected.push({
      place,
      reason: decision.reason ?? "low_value_facility",
      detail: decision.detail,
    });
    if (debug) {
      logAiPipeline(
        "[PLACE_QUALITY_REJECT]",
        `place=${(place.name ?? "").slice(0, 80)}`,
        `types=${(place.types ?? []).slice(0, 6).join(",")}`,
        `reason=${decision.reason ?? "unknown"}`,
        `detail=${decision.detail ?? ""}`,
        `source=${opts?.source ?? "tourism_quality_gate"}`,
      );
    }
  }

  return {
    kept,
    rejected,
    excludedLowValueCount: rejected.length,
  };
}
