/**
 * Quality gates for combination place candidates before Place Details / itinerary use.
 */
import { isGenericDestinationPlaceholder, isGenericPlaceLabel } from "@/lib/ai/generic-place-label";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { distanceMeters } from "@/lib/map-explore";
import {
  isLikelyPlaceName,
  normalizePlaceCandidateName,
  logNonPlaceCandidateRejected,
  logAffiliateExcludedFromPlacePool,
  type NonPlaceRejectReason,
  type PlaceNameLikelihood,
} from "@/lib/ai/place-name-likelihood";
import {
  themeRequiresCategoryContract,
  validatePlaceForCombination,
} from "@/lib/ai/combination-category-contract";
import { isTourismLandmarkException } from "@/lib/ai/tourism-quality-gate";
import { isFallbackPlanningPlaceId, isHardGooglePlaceId } from "@/lib/ai/planning-place-id";
import type { PlaceResult } from "@/lib/place-result";
import { combinationThemeTitle } from "@/lib/ai/combination-theme-titles";
import { destinationEditorialMessages } from "@/lib/i18n/destination-editorial";
import type { Locale } from "@/lib/i18n/types";
import {
  touristQualityDecision,
  type TouristQualityDecision,
  type TouristQualityIntent,
  type TouristQualityProtection,
} from "@/lib/tourist-quality-gate";

export type CandidateIntentInput = {
  name: string;
  types?: string[];
  primaryType?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  rating?: number | null;
  googlePlaceId?: string;
  /** Tourist Quality Gate evidence (optional, read-only). */
  userRatingCount?: number | null;
  regularOpeningHours?: unknown;
  currentOpeningHours?: unknown;
  reviewEvidence?: unknown;
};

const CULTURAL_THEME_FACETS = new Set(["culture", "museum", "art", "historic", "heritage"]);

/** Tourist Quality Gate intent for a combination (culture / historic themes → cultural_exploration). */
export function touristQualityIntentForCombination(combination: {
  title?: string;
  theme?: string;
}): TouristQualityIntent {
  const facets = primaryThemesForCombinationTheme(
    (combination.theme ?? "").trim().toLowerCase(),
    combination.title,
  );
  return facets.some((f) => CULTURAL_THEME_FACETS.has(f))
    ? "cultural_exploration"
    : "general_sightseeing";
}

/**
 * Canonical travel intent of a combination: derived from its stable theme key only, never from a
 * (localized) title. A missing theme yields general_sightseeing (strictest: never admits LOW).
 */
export function canonicalCombinationTouristQualityIntent(
  theme: string | null | undefined,
): TouristQualityIntent {
  return touristQualityIntentForCombination({ theme: theme ?? "" });
}

/**
 * Older-session compatibility only (snapshot has no themeKey and no consistent verdict intent):
 * derive the intent from the combination title. Only an explicitly recognizable theme counts;
 * unrecognized titles (incl. non-zh localized ones) stay general_sightseeing. The result is a
 * re-judging intent — never a trusted original intent, never grounds to reuse a first-pass verdict.
 */
export function legacyTitleCombinationTouristQualityIntent(
  title: string | null | undefined,
): TouristQualityIntent {
  if (typeof title !== "string") return "general_sightseeing";
  // Only explicit Chinese theme titles are recognizable; kana / hangul (ja / ko localized titles
  // that may share CJK characters such as 文化・寺院) stay conservative.
  if (/[぀-ヿㇰ-ㇿｦ-ﾟᄀ-ᇿ㄰-㆏가-힯]/.test(title)) {
    return "general_sightseeing";
  }
  // Kanji-only ja product copy (e.g. 寺院文化) is not distinguishable by script: an exact match
  // against a non-zh app localization of a theme title is never a zh title.
  if (nonZhLocalizedThemeTitles().has(title.trim())) return "general_sightseeing";
  const key = resolveThemeKeyFromTitle(title);
  return key === "attraction"
    ? "general_sightseeing"
    : canonicalCombinationTouristQualityIntent(key);
}

/** App theme-title keys (combination-theme-titles THEME_TITLES rows). */
const APP_THEME_TITLE_KEYS = [
  "historic",
  "culture",
  "nature",
  "coast",
  "cafe",
  "food",
  "shopping",
  "market",
  "attraction",
  "suburb",
  "temple_trail",
  "sunset_views",
  "temple_culture",
  "classic_pagoda",
  "landmark_walk",
  "culture_stroll",
] as const;
const NON_ZH_LOCALES: readonly Locale[] = ["en", "ja", "ko"];
let nonZhLocalizedThemeTitleSet: Set<string> | null = null;

/** Every app-produced en/ja/ko theme title that differs from its zh-TW source. */
function nonZhLocalizedThemeTitles(): Set<string> {
  if (nonZhLocalizedThemeTitleSet) return nonZhLocalizedThemeTitleSet;
  const set = new Set<string>();
  for (const key of APP_THEME_TITLE_KEYS) {
    const zh = combinationThemeTitle(key, "zh-TW");
    for (const loc of NON_ZH_LOCALES) {
      const title = combinationThemeTitle(key, loc).trim();
      if (title && title !== zh) set.add(title);
    }
  }
  const zhEditorial = destinationEditorialMessages["zh-TW"];
  for (const [key, zh] of Object.entries(zhEditorial)) {
    if (!key.startsWith("theme_")) continue;
    for (const loc of NON_ZH_LOCALES) {
      const title = destinationEditorialMessages[loc]?.[key]?.trim();
      if (title && title !== zh) set.add(title);
    }
  }
  nonZhLocalizedThemeTitleSet = set;
  return set;
}

/** Non-Google identity prefixes (same set isHardGooglePlaceId / discovery top-up exclude). */
const NON_GOOGLE_PLACE_ID_RE =
  /^(?:name|synthetic|generated|fallback|landmark-cache|core|dayplan|latlng|session|trip|memory):|^(?:saved|mock|rec)-|fallback/i;
/** Google Place IDs are opaque URL-safe tokens; the ChIJ prefix is common but not guaranteed. */
const OPAQUE_GOOGLE_PLACE_ID_RE = /^[A-Za-z0-9_-]{16,}$/;

/**
 * Place ID used for Tourist Quality Gate identity (selected-place protection, snapshot verdicts):
 * `places/` stripped; synthetic / fallback / name-derived IDs rejected (null). Identity is strict
 * equality of two normalized IDs — the format check only excludes IDs we generate ourselves.
 */
export function normalizeTrustedGooglePlaceId(placeId: string | null | undefined): string | null {
  const id = (placeId ?? "").trim().replace(/^places\//i, "");
  if (!id) return null;
  if (isHardGooglePlaceId(id)) return id;
  if (isFallbackPlanningPlaceId(id) || NON_GOOGLE_PLACE_ID_RE.test(id)) return null;
  return OPAQUE_GOOGLE_PLACE_ID_RE.test(id) ? id : null;
}

/** Shared Tourist Quality Gate decision for combination / itinerary candidates. */
export function candidateTouristQualityDecision(
  candidate: CandidateIntentInput,
  combination: { title?: string; theme?: string },
  protection?: TouristQualityProtection | null,
  /** Explicit intent (Gate only); defaults to the intent derived from `combination`. */
  intent?: TouristQualityIntent,
): TouristQualityDecision {
  return touristQualityDecision(
    {
      name: candidate.name,
      primaryType: candidate.primaryType,
      types: candidate.types,
      regularOpeningHours: candidate.regularOpeningHours,
      currentOpeningHours: candidate.currentOpeningHours,
      reviewEvidence: candidate.reviewEvidence,
    },
    { intent: intent ?? touristQualityIntentForCombination(combination), protection },
  );
}

export type CandidateValidationResult = {
  ok: boolean;
  reason?: string;
};

export type { NonPlaceRejectReason, PlaceNameLikelihood };
export {
  isLikelyPlaceName,
  normalizePlaceCandidateName,
  logNonPlaceCandidateRejected,
  logAffiliateExcludedFromPlacePool,
};

const NON_TOURISM_NAME_RE =
  /協會|學會|創價|辦公室|總部|股份有限|有限公司|企業社|工作室|戶政|地政|公所|清潔隊|停車場|停車格|便利商店|超商|加油站|銀行|ATM|診所|醫院|藥局|學校|長照|殯儀|宅配|物流|私人會所|會員中心/;

const NON_TOURISM_TYPES = new Set([
  "parking",
  "gas_station",
  "convenience_store",
  "bank",
  "atm",
  "hospital",
  "pharmacy",
  "school",
  "primary_school",
  "secondary_school",
  "local_government_office",
  "police",
  "fire_station",
  "post_office",
  "insurance_agency",
  "real_estate_agency",
  "accounting",
  "lawyer",
  "dentist",
  "doctor",
  "veterinary_care",
  "car_repair",
  "car_dealer",
  "storage",
  "moving_company",
  "funeral_home",
  "travel_agency",
  "tour_operator",
  "event_ticket_seller",
  "taxi_stand",
  "car_rental",
  "bus_station",
  "train_station",
  "subway_station",
  "transit_station",
  "light_rail_station",
]);

const TOURISM_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
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
  "market",
  "shopping_mall",
  "department_store",
  "clothing_store",
  "store",
  "book_store",
  "bookstore",
  "souvenir_store",
  "gift_shop",
  "supermarket",
  "night_club",
  "movie_theater",
  "stadium",
  "natural_feature",
  "point_of_interest",
  "landmark",
  "establishment",
  "restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "food",
  "meal_takeaway",
  "food_court",
  "dessert_shop",
]);

/** Theme keywords used to check combination fit (soft). */
const THEME_HINTS: Record<string, RegExp> = {
  historic: /廟|寺|教堂|神社|城隍|州廳|古蹟|老街|城門|孔廟|histor|monument|temple|shrine|church/i,
  culture:
    /博物|美術|藝文|文化館|玻璃|展覽|museum|gallery|art|cultural|theater|theatre/i,
  nature: /公園|動物園|綠地|湖|草原|步道|濕地|park|zoo|garden|natural/i,
  coast: /漁港|海岸|海灘|濱海|碼頭|天梯|港|beach|marina|harbor|harbour|coast/i,
  market: /夜市|市場|商圈|老街|市集|商場|market|shopping|mall|street/i,
  attraction: /景點|地標|觀景|塔|橋|園區|tourist|landmark|attraction/i,
  suburb: /山|湖|牧場|森林|露營|溫泉|農場|溪|mountain|farm|hot.?spring|forest/i,
};

const MAX_DISTANCE_FROM_CENTER_M = 55_000;

function typeSet(candidate: CandidateIntentInput): Set<string> {
  return new Set(
    [...(candidate.types ?? []), candidate.primaryType ?? ""]
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
}

function destinationInAddress(
  address: string | null | undefined,
  destination: string,
): boolean {
  if (!address?.trim()) return false;
  const addr = address.replace(/\s+/g, "");
  const dest = destination.replace(/\s+/g, "");
  if (!dest) return true;
  if (addr.includes(dest)) return true;
  if (dest.includes("台") && addr.includes(dest.replace(/台/g, "臺"))) return true;
  if (dest.includes("臺") && addr.includes(dest.replace(/臺/g, "台"))) return true;
  const bare = dest.replace(/(市|縣|區)$/, "");
  return bare.length >= 2 && addr.includes(bare);
}

/**
 * Validate a candidate before it occupies a primary slot or enters the itinerary.
 */
export function validateCandidateIntent(
  candidate: CandidateIntentInput,
  combination: { title?: string; theme?: string },
  destination: string,
  opts?: {
    center?: { lat: number; lng: number } | null;
    requireTourismType?: boolean;
    source?: string;
    /** Explicit / Required / Locked / Selected-only: Tourist Quality Gate never removes these. */
    protection?: TouristQualityProtection | null;
    /** Tourist Quality Gate intent override; affects only the Gate, never the theme contract. */
    touristQualityIntent?: TouristQualityIntent;
  },
): CandidateValidationResult {
  const label = normalizeDestinationLabel(destination);
  const rawName = candidate.name?.trim() ?? "";

  logAiPipeline(
    "[RAW_PLACE_CANDIDATE]",
    `name=${rawName.slice(0, 160)}`,
    `source=${opts?.source ?? "candidate_intent"}`,
  );

  if (!rawName || rawName.length < 2) {
    return { ok: false, reason: "incomplete_name" };
  }

  const normalized = normalizePlaceCandidateName(rawName);
  if (!normalized.accepted) {
    logNonPlaceCandidateRejected(
      rawName,
      normalized.reason ?? "long_marketing_text",
      opts?.source ?? "candidate_intent",
    );
    return { ok: false, reason: normalized.reason ?? "rejected_non_place" };
  }

  const name = normalized.normalized;

  if (isGenericPlaceLabel(name, label) || isGenericDestinationPlaceholder(name, label)) {
    return { ok: false, reason: "generic_category_label" };
  }
  if (/^[A-Za-z0-9\s]{1,3}$/.test(name) || /…|\.\.\.|待定|未知|測試/.test(name)) {
    return { ok: false, reason: "incomplete_or_fictional" };
  }
  if (NON_TOURISM_NAME_RE.test(name)) {
    return { ok: false, reason: "non_tourism_name" };
  }
  if (
    /飲水|水飲み|聖火台|時計台|電視塔|テレビ塔|市役所|區役所|区役所|道廳|廳舍|庁舎|近鄰公園|drinking\s*fountain|olympic\s*cauldron/i.test(
      name,
    )
  ) {
    const asPlace = {
      id: candidate.googlePlaceId ?? name,
      name,
      address: candidate.address ?? null,
      lat: candidate.lat ?? null,
      lng: candidate.lng ?? null,
      rating: candidate.rating ?? null,
      userRatingCount: null,
      photoName: null,
      primaryType: candidate.primaryType ?? null,
      types: candidate.types ?? null,
      businessStatus: null,
      openStatus: "unknown" as const,
      openStatusLabel: "",
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
    } satisfies PlaceResult;
    if (!isTourismLandmarkException(asPlace)) {
      return { ok: false, reason: "low_value_tourism_gate" };
    }
  }
  if (
    isForbiddenTransitAttraction({
      name,
      types: candidate.types,
      primaryType: candidate.primaryType,
    })
  ) {
    return { ok: false, reason: "transit_or_station" };
  }

  const types = typeSet(candidate);
  for (const t of types) {
    if (NON_TOURISM_TYPES.has(t)) {
      return { ok: false, reason: `forbidden_type:${t}` };
    }
  }

  if (
    (types.has("travel_agency") ||
      types.has("tour_operator") ||
      types.has("event_ticket_seller")) &&
    !types.has("tourist_attraction")
  ) {
    return { ok: false, reason: "forbidden_type:tour_commerce" };
  }

  if (opts?.requireTourismType && types.size > 0) {
    const hasTourism = [...types].some((t) => TOURISM_TYPES.has(t));
    if (!hasTourism) {
      return { ok: false, reason: "non_tourism_place_type" };
    }
  }

  if (candidate.address && !destinationInAddress(candidate.address, label)) {
    if (
      opts?.center &&
      candidate.lat != null &&
      candidate.lng != null &&
      distanceMeters(opts.center, { lat: candidate.lat, lng: candidate.lng }) >
        MAX_DISTANCE_FROM_CENTER_M
    ) {
      return { ok: false, reason: "outside_destination" };
    }
  }

  if (
    opts?.center &&
    candidate.lat != null &&
    candidate.lng != null &&
    (Math.abs(candidate.lat) > 0.001 || Math.abs(candidate.lng) > 0.001)
  ) {
    const dist = distanceMeters(opts.center, {
      lat: candidate.lat,
      lng: candidate.lng,
    });
    if (dist > MAX_DISTANCE_FROM_CENTER_M) {
      return { ok: false, reason: "outside_destination_radius" };
    }
  }

  const touristQuality = candidateTouristQualityDecision(
    candidate,
    combination,
    opts?.protection,
    opts?.touristQualityIntent,
  );
  if (!touristQuality.admit) {
    return { ok: false, reason: touristQuality.reason };
  }

  const themeKey = (combination.theme ?? "").trim().toLowerCase();

  // Strict category contracts for food / shopping / cafe / market / nature.
  if (themeRequiresCategoryContract(themeKey, combination.title)) {
    const categoryCheck = validatePlaceForCombination(
      {
        name,
        types: candidate.types,
        primaryType: candidate.primaryType,
        address: candidate.address,
      },
      themeKey,
      { title: combination.title },
    );
    if (!categoryCheck.valid) {
      return {
        ok: false,
        reason: categoryCheck.rejectReason ?? `theme_mismatch:${themeKey}`,
      };
    }
  } else {
    const hint = THEME_HINTS[themeKey];
    if (hint) {
      const blob = `${name} ${candidate.address ?? ""} ${[...types].join(" ")}`;
      if (types.size > 0 && !hint.test(blob)) {
        const cultureTypes = /museum|art_gallery|cultural/i;
        if (themeKey === "culture" && !cultureTypes.test([...types].join(" "))) {
          if (
            !hint.test(name) &&
            !types.has("tourist_attraction") &&
            !types.has("point_of_interest")
          ) {
            return { ok: false, reason: "theme_mismatch:culture" };
          }
        }
      }
    }
  }

  return { ok: true };
}

export function logRejectedCandidate(
  candidate: CandidateIntentInput,
  combinationId: number | string,
  reason: string,
): void {
  logAiPipeline(
    "[COMBINATION_CANDIDATE_REJECTED]",
    `combinationId=${combinationId}`,
    `name=${candidate.name}`,
    `reason=${reason}`,
  );
}

/** Theme → Places Text Search query fragments for destination-scoped refill. */
export function themeSearchQueries(theme: string, destination: string): string[] {
  const label = normalizeDestinationLabel(destination);
  const key = theme.trim().toLowerCase();
  const byTheme: Record<string, string[]> = {
    culture: [
      `${label} 博物館`,
      `${label} 美術館`,
      `${label} 文化館`,
      `museum ${label}`,
      `art museum ${label}`,
      `cultural center ${label}`,
      `gallery ${label}`,
    ],
    museum: [
      `${label} 博物館`,
      `museum ${label}`,
      `art museum ${label}`,
    ],
    art: [
      `${label} 美術館`,
      `gallery ${label}`,
      `art museum ${label}`,
    ],
    historic: [
      `${label} 古蹟`,
      `${label} 老街`,
      `${label} 廟`,
      `historic ${label}`,
      `temple ${label}`,
    ],
    temple: [`${label} 廟`, `${label} 寺`, `temple ${label}`, `shrine ${label}`],
    heritage: [`${label} 古蹟`, `heritage ${label}`, `historic ${label}`],
    market: [
      `${label} 夜市`,
      `${label} 市場`,
      `${label} 商圈`,
      `market ${label}`,
      `night market ${label}`,
    ],
    night_market: [`${label} 夜市`, `night market ${label}`],
    food: [
      `${label} 人氣餐廳`,
      `${label} 在地小吃`,
      `${label} 必吃美食`,
      `${label} 夜市`,
      `${label} 甜點`,
      `${label} local restaurant`,
      `${label} popular food`,
    ],
    cafe: [
      `${label} 咖啡廳`,
      `${label} cafe`,
      `${label} coffee`,
      `${label} 甜點`,
      `${label} bakery`,
    ],
    shopping: [
      `${label} 商圈`,
      `${label} 百貨`,
      `${label} 購物中心`,
      `${label} 老街`,
      `${label} 市場`,
      `${label} 伴手禮`,
      `shopping mall ${label}`,
      `shopping street ${label}`,
      `department store ${label}`,
    ],
    nature: [`${label} 公園`, `${label} 濕地`, `park ${label}`, `garden ${label}`],
    park: [`${label} 公園`, `park ${label}`, `garden ${label}`],
    coast: [
      `${label} 海岸`,
      `${label} 漁港`,
      `${label} 海濱`,
      `${label} 港區`,
      `${label} 夕陽`,
      `${label} 觀景點`,
      `${label} 海濱步道`,
      `beach ${label}`,
      `harbor ${label}`,
      `sunset viewpoint ${label}`,
      `coastal walk ${label}`,
    ],
    harbor: [
      `${label} 港`,
      `${label} 漁港`,
      `${label} 碼頭`,
      `harbor ${label}`,
      `marina ${label}`,
    ],
    sunset: [
      `${label} 夕陽`,
      `${label} 日落`,
      `${label} 觀景`,
      `sunset ${label}`,
      `sunset viewpoint ${label}`,
    ],
    scenic_walk: [
      `${label} 步道`,
      `${label} 海濱步道`,
      `${label} 觀景`,
      `promenade ${label}`,
      `scenic walk ${label}`,
    ],
    suburb: [`${label} 溫泉`, `${label} 農場`, `${label} 森林`, `hot spring ${label}`],
    hot_spring: [`${label} 溫泉`, `hot spring ${label}`],
    attraction: [
      `${label} 景點`,
      `${label} 必去`,
      `tourist attractions ${label}`,
      `landmark ${label}`,
    ],
    landmark: [`${label} 地標`, `landmark ${label}`, `tourist attraction ${label}`],
  };
  return byTheme[key] ?? byTheme.attraction!;
}

/** Expand a base theme into search facets (single-select theme supplement). */
export function primaryThemesForCombinationTheme(
  theme: string,
  title?: string,
): string[] {
  const key = (theme || resolveThemeKeyFromTitle(title ?? "")).trim().toLowerCase();
  const facets: Record<string, string[]> = {
    coast: ["coast", "harbor", "sunset", "scenic_walk"],
    culture: ["culture", "museum", "art"],
    historic: ["historic", "temple", "heritage"],
    market: ["market", "night_market", "shopping"],
    food: ["food", "night_market", "cafe"],
    cafe: ["cafe", "food"],
    shopping: ["shopping", "market"],
    nature: ["nature", "park", "scenic_walk"],
    suburb: ["suburb", "nature", "hot_spring"],
    attraction: ["attraction", "landmark", "scenic_walk"],
    soft: ["food", "shopping", "cafe", "nature"],
  };
  return facets[key] ?? facets.attraction!;
}

export function resolveThemeKeyFromTitle(title: string | null | undefined): string {
  // Old / corrupt sessions may carry a non-string title: unrecognizable → conservative default.
  if (typeof title !== "string") return "attraction";
  const t = title.replace(/\s+/g, "");
  if (/人氣美食|美食|餐廳|小吃|夜市小吃|在地美食|美食咖啡|美食市集|美食夜生活/.test(t)) {
    if (/購物|百貨|商場/.test(t) && !/美食|餐廳|小吃/.test(t)) return "shopping";
    if (/咖啡甜點|咖啡散步/.test(t) && !/美食|餐廳|小吃|夜市/.test(t)) return "cafe";
    return "food";
  }
  if (/購物|百貨|商場|Outlet|散策|伴手禮|老街市集散策/.test(t)) return "shopping";
  if (/咖啡|甜點|烘焙/.test(t)) return "cafe";
  if (/藝文|博物|美術|文化/.test(t)) return "culture";
  if (/舊城|古蹟|廟|寺|文化古/.test(t)) return "historic";
  if (/商圈|市集|夜市|市場/.test(t)) return "market";
  if (/海岸|漁港|海灘|夕陽/.test(t)) return "coast";
  if (/近郊|溫泉|牧場|森林/.test(t)) return "suburb";
  if (/慢遊|公園|綠地|自然|風景/.test(t)) return "nature";
  return "attraction";
}
