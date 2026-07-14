/**
 * Quality gates for combination place candidates before Place Details / itinerary use.
 */
import { isGenericDestinationPlaceholder, isGenericPlaceLabel } from "@/lib/ai/generic-place-label";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { distanceMeters } from "@/lib/map-explore";

export type CandidateIntentInput = {
  name: string;
  types?: string[];
  primaryType?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  rating?: number | null;
  googlePlaceId?: string;
};

export type CandidateValidationResult = {
  ok: boolean;
  reason?: string;
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
]);

const TOURISM_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "zoo",
  "aquarium",
  "amusement_park",
  "aquarium",
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
  "night_club",
  "movie_theater",
  "stadium",
  "aquarium",
  "natural_feature",
  "point_of_interest",
  "landmark",
  "establishment",
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
  // Soft: county / city suffix variants
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
  },
): CandidateValidationResult {
  const label = normalizeDestinationLabel(destination);
  const name = candidate.name?.trim() ?? "";

  if (!name || name.length < 2) {
    return { ok: false, reason: "incomplete_name" };
  }
  if (isGenericPlaceLabel(name, label) || isGenericDestinationPlaceholder(name, label)) {
    return { ok: false, reason: "generic_category_label" };
  }
  if (/^[A-Za-z0-9\s]{1,3}$/.test(name) || /…|\.\.\.|待定|未知|測試/.test(name)) {
    return { ok: false, reason: "incomplete_or_fictional" };
  }
  if (NON_TOURISM_NAME_RE.test(name)) {
    return { ok: false, reason: "non_tourism_name" };
  }
  if (isForbiddenTransitAttraction({ name, types: candidate.types, primaryType: candidate.primaryType })) {
    return { ok: false, reason: "transit_or_station" };
  }

  const types = typeSet(candidate);
  for (const t of types) {
    if (NON_TOURISM_TYPES.has(t)) {
      return { ok: false, reason: `forbidden_type:${t}` };
    }
  }

  if (opts?.requireTourismType && types.size > 0) {
    const hasTourism = [...types].some((t) => TOURISM_TYPES.has(t));
    if (!hasTourism) {
      return { ok: false, reason: "non_tourism_place_type" };
    }
  }

  if (candidate.address && !destinationInAddress(candidate.address, label)) {
    // Soft fail only when coords also miss the destination range below.
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

  const themeKey = (combination.theme ?? "").trim().toLowerCase();
  const hint = THEME_HINTS[themeKey];
  if (hint) {
    const blob = `${name} ${candidate.address ?? ""} ${[...types].join(" ")}`;
    // Soft: only reject when types clearly conflict with theme and name has no hint.
    if (types.size > 0 && !hint.test(blob)) {
      const cultureTypes = /museum|art_gallery|cultural/i;
      const marketTypes = /market|shopping_mall|store/i;
      if (themeKey === "culture" && !cultureTypes.test([...types].join(" "))) {
        // Allow point_of_interest / establishment when name still matches culture hint
        if (!hint.test(name) && !types.has("tourist_attraction") && !types.has("point_of_interest")) {
          return { ok: false, reason: "theme_mismatch:culture" };
        }
      }
      if (themeKey === "market" && !marketTypes.test([...types].join(" ")) && !hint.test(name)) {
        if (!types.has("tourist_attraction") && !types.has("point_of_interest")) {
          return { ok: false, reason: "theme_mismatch:market" };
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
    historic: [
      `${label} 古蹟`,
      `${label} 老街`,
      `${label} 廟`,
      `historic ${label}`,
      `temple ${label}`,
    ],
    market: [
      `${label} 夜市`,
      `${label} 市場`,
      `${label} 商圈`,
      `market ${label}`,
      `night market ${label}`,
    ],
    nature: [`${label} 公園`, `${label} 濕地`, `park ${label}`, `garden ${label}`],
    coast: [`${label} 海岸`, `${label} 漁港`, `beach ${label}`, `harbor ${label}`],
    suburb: [`${label} 溫泉`, `${label} 農場`, `${label} 森林`, `hot spring ${label}`],
    attraction: [
      `${label} 景點`,
      `${label} 必去`,
      `tourist attractions ${label}`,
      `landmark ${label}`,
    ],
  };
  return byTheme[key] ?? byTheme.attraction!;
}

export function resolveThemeKeyFromTitle(title: string): string {
  const t = title.replace(/\s+/g, "");
  if (/藝文|博物|美術|文化/.test(t)) return "culture";
  if (/舊城|古蹟|廟|寺|文化古/.test(t)) return "historic";
  if (/商圈|市集|夜市|市場/.test(t)) return "market";
  if (/海岸|漁港|海灘|夕陽/.test(t)) return "coast";
  if (/近郊|溫泉|牧場|森林/.test(t)) return "suburb";
  if (/慢遊|公園|綠地|自然/.test(t)) return "nature";
  return "attraction";
}
