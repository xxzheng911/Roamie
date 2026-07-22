import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeRecommendationItem } from "@/lib/ai/types";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";
import {
  buildDynamicDestinationCombinations,
  hasDynamicDestinationCombinations,
} from "@/lib/ai/destination-travel-profile";
import { isCountryLevelDestination } from "@/lib/ai/destination-scope";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";
import {
  isGenericDestinationPlaceholder,
} from "@/lib/ai/generic-place-label";
import {
  isLikelyPlaceName,
  normalizePlaceCandidateName,
  logNonPlaceCandidateRejected,
} from "@/lib/ai/place-name-likelihood";
import {
  INSUFFICIENT_COMBINATION_PLACES_MESSAGE,
  validateCombinationOptions,
  getCachedDiscoveredCombinations,
  PRIMARY_PLACES_PER_COMBO,
  type StructuredCombinationOption,
} from "@/lib/ai/destination-combination-discovery";
import {
  buildThemeSearchDirections,
  type ThemeSearchDirection,
} from "@/lib/ai/destination-discovery-queries";
import { hasValidTripDuration } from "@/lib/ai/trip-duration-guard";
import {
  applyNearbyRegionPolicyToCombinations,
  isNearbyRegionThemeTitle,
} from "@/lib/ai/region-adjacency";

export type DestinationCombination = {
  title: string;
  places: string[];
};

export type { ThemeSearchDirection };

export { INSUFFICIENT_COMBINATION_PLACES_MESSAGE, isGenericDestinationPlaceholder };

/** Category keywords that must never appear as combination place names. */
const THEME_CATEGORY_LABELS = new Set([
  "海灘",
  "跳島",
  "日落海岸",
  "老城",
  "教堂",
  "市集",
  "海鮮",
  "夜市",
  "酒吧街",
  "瀑布",
  "山林",
  "湖畔",
  "市區地標",
  "老街",
  "文創園區",
  "咖啡街",
  "商圈",
  "小吃街",
  "市場",
  "步道",
  "海岸",
  "地標",
  "神社寺廟",
  "舊城",
  "公園",
  "河畔",
  "美食街",
  "咖啡店街",
  "近郊景點",
  "溫泉",
  "山區",
  "地標廣場",
  "老城區",
  "河岸",
  "博物館",
  "藝廊",
  "劇院區",
  "餐酒館",
  "近郊小鎮",
  "觀景點",
  "自然風景",
]);

export function isThemeCategoryLabel(value: string): boolean {
  const n = value.trim().replace(/\s+/g, "");
  return THEME_CATEGORY_LABELS.has(n) || THEME_CATEGORY_LABELS.has(value.trim());
}

export function dropGenericCombinationLabel(
  value: string,
  reason = "not_a_real_place",
): boolean {
  const trimmed = value.trim();
  // Exact category keywords only — do not substring-match (e.g. keep「暹羅商圈」).
  const dropped = isThemeCategoryLabel(trimmed) || !isLikelyPlaceName(trimmed).ok;
  if (dropped) {
    logAiPipeline(
      "[COMBINATION_GENERIC_LABEL_DROPPED]",
      `value=${value}`,
      `reason=${reason}`,
    );
  }
  return dropped;
}

/** 已知目的地時，禁止出現的其他城市／錯誤模板關鍵字（資料隔離，非流程分支） */
const REJECTED_SCOPE_MARKERS: Record<string, readonly string[]> = {
  首爾: ["東京", "京都", "大阪", "台北", "臺北", "象山", "九份", "夜市模板", "信義區"],
  東京: ["首爾", "台北", "臺北", "象山", "高雄", "台中", "臺中"],
  大阪: ["首爾", "台北", "臺北", "象山", "曼谷"],
  京都: ["首爾", "台北", "臺北", "象山", "曼谷"],
  台東: ["東京", "京都", "大阪", "首爾", "象山", "台北101"],
  臺東: ["東京", "京都", "大阪", "首爾", "象山", "台北101"],
  台中: ["東京", "京都", "大阪", "首爾", "象山", "九份"],
  臺中: ["東京", "京都", "大阪", "首爾", "象山", "九份"],
  台南: ["東京", "京都", "大阪", "首爾", "象山"],
  高雄: ["東京", "京都", "大阪", "首爾", "象山", "九份"],
};

const GLOBAL_CITY_LIST_RE =
  /^(東京|京都|大阪|首爾|台北|臺北|曼谷|高雄|台中|臺中|台南|臺南|巴黎|紐約)(、|,|\s|$)/;

/**
 * Destination-agnostic: any non-empty searchable destination can offer combinations.
 * Country-level labels are excluded — city/region must be chosen first.
 */
export function hasDestinationCombinations(destination: string): boolean {
  const label = normalizeDestinationLabel(destination);
  if (!label) return false;
  if (isCountryLevelDestination(label)) return false;
  return hasDynamicDestinationCombinations(label);
}

/**
 * Theme fallback for SEARCH DIRECTION only.
 * Returns titles + queries — places are always empty (never fake category labels).
 * Use buildThemeSearchDirections for full query metadata.
 */
export function buildThemeFallbackCombinations(
  destination: string,
  countryHint?: string | null,
): DestinationCombination[] {
  const directions = buildThemeSearchDirections(destination, countryHint);
  return directions.map((d) => ({
    title: d.title,
    places: [],
  }));
}

/** @deprecated Prefer buildThemeSearchDirections — kept for call-site compatibility. */
export function buildThemeSearchDirectionsForDestination(
  destination: string,
  countryHint?: string | null,
): ThemeSearchDirection[] {
  return buildThemeSearchDirections(destination, countryHint);
}

/** True when title matches a search-direction theme (not Places-backed). */
export function isThemeFallbackCombinationTitle(
  destination: string,
  title: string,
  countryHint?: string | null,
): boolean {
  return buildThemeSearchDirections(destination, countryHint).some(
    (c) => c.title === title,
  );
}

export function logChatDestinationScopeLock(destination: string): void {
  logAiPipeline("[CHAT_DESTINATION_SCOPE_LOCK]", `destination=${normalizeDestinationLabel(destination)}`);
}

export function isSuggestionInDestinationScope(
  suggestionText: string,
  destination: string,
): boolean {
  const label = normalizeDestinationLabel(destination);
  const text = suggestionText.trim();
  if (!text) return false;

  const rejected = REJECTED_SCOPE_MARKERS[label] ?? [];
  for (const marker of rejected) {
    if (text.includes(marker)) {
      logAiPipeline(
        "[CHAT_WRONG_CITY_SUGGESTION_REJECTED]",
        `destination=${label}`,
        `suggestion=${text.slice(0, 40)}`,
        `marker=${marker}`,
      );
      return false;
    }
  }

  if (isKnownTouristCityLabel(label) && GLOBAL_CITY_LIST_RE.test(text)) {
    logAiPipeline(
      "[CHAT_WRONG_CITY_SUGGESTION_REJECTED]",
      `destination=${label}`,
      `reason=global_city_list`,
      `suggestion=${text.slice(0, 40)}`,
    );
    return false;
  }

  return true;
}

export function filterSuggestionsByDestinationScope<T extends { name?: string; placeName?: string }>(
  suggestions: T[],
  destination: string,
): T[] {
  logChatDestinationScopeLock(destination);
  return suggestions.filter((item) => {
    const name = (item.placeName ?? item.name ?? "").trim();
    if (!name) return false;
    return isSuggestionInDestinationScope(name, destination);
  });
}

function toStructuredForValidation(
  destination: string,
  combos: DestinationCombination[],
): StructuredCombinationOption[] {
  return combos.map((combo, index) => ({
    combinationId: `${destination}:${index + 1}`,
    title: combo.title,
    theme: combo.title.replace(/組合$/, ""),
    placeCandidates: combo.places.map((name) => ({
      name,
      searchCandidateId: `name:${name}`,
      types: [],
    })),
  }));
}

/**
 * Real place combinations only.
 * Prefer Places discovery cache; never pad with theme-category labels.
 * `allowThemeFallback` is ignored (kept for API compat) — themes are search-only.
 */
export function getDestinationCombinations(
  destination: string,
  opts?: {
    allowThemeFallback?: boolean;
    countryHint?: string | null;
    tripDays?: number | null;
    includeFartherNearby?: boolean;
  },
): DestinationCombination[] {
  const label = normalizeDestinationLabel(destination);

  const cached = getCachedDiscoveredCombinations(label);
  if (cached?.length) {
    const fromCache = cached
      .map((combo) => {
        const primary = combo.primaryCandidates?.length
          ? combo.primaryCandidates
          : combo.placeCandidates.slice(0, PRIMARY_PLACES_PER_COMBO);
        const places = primary
          .map((c) => c.name)
          .filter(
            (place) =>
              place &&
              !dropGenericCombinationLabel(place) &&
              isSuggestionInDestinationScope(place, destination) &&
              !isForbiddenTransitAttraction({ name: place }),
          );
        return { title: combo.title, places };
      })
      .filter((combo) => combo.places.length >= 2);

    return applyNearbyRegionPolicyToCombinations(label, fromCache, {
      tripDays: opts?.tripDays,
      includeFarther: Boolean(opts?.includeFartherNearby),
      forceInclude: opts?.tripDays == null,
      maxCandidates: opts?.tripDays == null ? 5 : undefined,
      countryHint: opts?.countryHint,
    });
  }

  const combos = buildDynamicDestinationCombinations(label, {
    tripDays: opts?.tripDays,
    includeFartherNearby: opts?.includeFartherNearby,
  })
    .map((combo) => ({
      title: combo.title,
      places: combo.places
        .map((place) => {
          const normalized = normalizePlaceCandidateName(place);
          if (!normalized.accepted) {
            logNonPlaceCandidateRejected(
              place,
              normalized.reason ?? "rejected_non_place",
              "getDestinationCombinations",
            );
            return null;
          }
          return normalized.normalized;
        })
        .filter((place): place is string => Boolean(place))
        .filter(
          (place) =>
            !dropGenericCombinationLabel(place) &&
            // Nearby region labels are cities outside primary scope — skip metro scope filter.
            (isNearbyRegionThemeTitle(combo.title) ||
              isSuggestionInDestinationScope(place, destination)) &&
            !isGenericDestinationPlaceholder(place, label) &&
            !isForbiddenTransitAttraction({ name: place }) &&
            (isNearbyRegionThemeTitle(combo.title) || isLikelyPlaceName(place).ok),
        ),
    }))
    .filter(
      (combo) =>
        combo.places.length >= 2 ||
        (isNearbyRegionThemeTitle(combo.title) && combo.places.length >= 1),
    );

  const validation = validateCombinationOptions(
    toStructuredForValidation(label, combos),
    label,
  );
  if (validation.ok) return combos;
  if (combos.length >= 3 && !validation.genericPlaceNames.length) {
    return combos;
  }
  // Never return theme-category placeholders as places.
  return [];
}

export function flattenDestinationCombinationPlaces(destination: string): string[] {
  const combos = getDestinationCombinations(destination);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const combo of combos) {
    for (const place of combo.places) {
      if (!seen.has(place) && isSuggestionInDestinationScope(place, destination)) {
        seen.add(place);
        out.push(place);
      }
    }
  }
  return out;
}

/** Persist combination options as structured session data (never text-only). */
export function buildOfferedCombinationsForSession(destination: string): NonNullable<
  import("@/lib/ai/travel-context").CanonicalTravelContext["offeredCombinations"]
> {
  const label = normalizeDestinationLabel(destination);
  const cached = getCachedDiscoveredCombinations(label);
  if (cached?.length) {
    return cached.map((combo, index) => {
      const primary = combo.primaryCandidates?.length
        ? combo.primaryCandidates
        : combo.placeCandidates.slice(0, PRIMARY_PLACES_PER_COMBO);
      return {
        id: index + 1,
        title: combo.title,
        places: primary.map((c) => ({
          candidateId: c.searchCandidateId ?? c.googlePlaceId ?? `name:${c.name}`,
          originalName: c.name,
          name: c.name,
          searchQuery: `${c.name} ${label}`,
          destination: label,
          sourceCombinationId: index + 1,
          isRequiredBySelection: false,
          googlePlaceId: c.googlePlaceId,
          latitude: c.coordinates?.lat,
          longitude: c.coordinates?.lng,
          address: c.address,
          types: c.types,
          primaryType: c.primaryType,
          normalizedCategory: c.normalizedCategory,
          combinationId: c.combinationId ?? index + 1,
          rating: c.rating,
          resolutionStatus: (c.googlePlaceId ? "resolved" : "named") as
            | "named"
            | "resolved"
            | "unresolved"
            | "pending",
        })),
      };
    });
  }

  return getDestinationCombinations(label).map((combo, index) => ({
    id: index + 1,
    title: combo.title,
    places: combo.places.map((name) => ({
      candidateId: `name:${name}`,
      originalName: name,
      name,
      searchQuery: `${name} ${label}`,
      destination: label,
      sourceCombinationId: index + 1,
      isRequiredBySelection: false,
      resolutionStatus: "named" as const,
    })),
  }));
}

/** Format YYYY-MM-DD → YYYY/MM/DD for display. */
function formatDisplayDate(iso?: string | null): string | null {
  const value = iso?.trim();
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value.replace(/-/g, "/");
}

/** Full travel date range when both start and end are complete calendar dates. */
function formatTravelDateRangeLine(
  startDate?: string | null,
  endDate?: string | null,
  tentative?: boolean,
): string | null {
  const start = formatDisplayDate(startDate);
  const end = formatDisplayDate(endDate);
  const prefix = tentative ? "暫定旅行日期" : "旅行日期";
  if (start && end) return `${prefix}：${start}～${end}`;
  if (start) return `${prefix}：${start}`;
  return null;
}

export function buildDestinationCombinationSuggestionsReply(
  destination: string,
  days: number,
  opts?: {
    startDate?: string | null;
    endDate?: string | null;
    weatherLine?: string | null;
    /** System-suggested mid-month dates (user only gave month + days). */
    tentativeDates?: boolean;
    /**
     * Force a specific combination list — must already contain real place names.
     * Theme-category labels are always dropped.
     */
    forceCombinations?: DestinationCombination[];
  },
): string | null {
  const label = normalizeDestinationLabel(destination);
  const combos = (opts?.forceCombinations?.length
    ? opts.forceCombinations
    : getDestinationCombinations(label, { tripDays: days })
  ).map((c) => ({ ...c, places: [...c.places] }));
  if (!combos.length) return null;

  // Structured data only — never surface category placeholders as places.
  for (const combo of combos) {
    combo.places = combo.places.filter((place) => {
      if (dropGenericCombinationLabel(place)) return false;
      if (isGenericDestinationPlaceholder(place, label)) {
        logAiPipeline(
          "[COMBINATION_VALIDATION_FAILED]",
          "reason=generic_in_reply_builder",
          `genericPlaceNames=[${place}]`,
        );
        return false;
      }
      if (isNearbyRegionThemeTitle(combo.title)) return place.trim().length >= 2;
      const likelihood = isLikelyPlaceName(place);
      if (!likelihood.ok) {
        logNonPlaceCandidateRejected(
          place,
          likelihood.reason ?? "rejected_non_place",
          "combination_reply_builder",
        );
        return false;
      }
      return true;
    });
  }

  // Prefer ≥3 combos with ≥3 real places each; allow ≥2 only when discovery is thin.
  // Nearby-region themes may list 1 city on medium-length trips.
  const displayCombos = combos.filter(
    (c) =>
      c.places.length >= 3 ||
      (isNearbyRegionThemeTitle(c.title) && c.places.length >= 1),
  );
  const softDisplay =
    displayCombos.length >= 3
      ? displayCombos
      : combos.filter(
          (c) =>
            c.places.length >= 2 ||
            (isNearbyRegionThemeTitle(c.title) && c.places.length >= 1),
        );
  if (softDisplay.length < 3) {
    return null;
  }

  logChatDestinationScopeLock(label);

  const dateLine = formatTravelDateRangeLine(
    opts?.startDate,
    opts?.endDate,
    opts?.tentativeDates,
  );

  const header = [
    opts?.weatherLine?.trim() || `好，我先記下 ${label} ${days} 天的行程方向。`,
    "",
    `以下是${label}的建議組合搭配，你可以選一組或多組混搭：`,
    "",
    ...softDisplay.map(
      (combo, index) => `${index + 1}. ${combo.title}：${combo.places.join("、")}`,
    ),
    "",
    ...(dateLine ? [dateLine, ""] : []),
    "回覆你比較有興趣的組合，我來幫你生成行程。",
  ];

  return header.join("\n");
}

export function pendingOptionTitlesForCombinations(destination: string): string[] {
  return getDestinationCombinations(destination).map((combo) => combo.title);
}

const ORDINAL_TO_INDEX: Record<string, number> = {
  一: 0,
  二: 1,
  三: 2,
  四: 3,
  五: 4,
  六: 5,
  七: 6,
  八: 7,
  九: 8,
  十: 9,
  壹: 0,
  貳: 1,
  叁: 2,
  參: 2,
  肆: 3,
  伍: 4,
};

function parseOrdinalCombinationIndices(text: string, combinationCount: number): number[] {
  const indices = new Set<number>();
  for (const match of text.matchAll(/第\s*([一二三四五六七八九十壹貳叁參肆伍\d]{1,2})\s*(?:個|組|個組合)?/g)) {
    const token = match[1] ?? "";
    if (/^\d{1,2}$/.test(token)) {
      const index = Number(token) - 1;
      if (index >= 0 && index < combinationCount) indices.add(index);
      continue;
    }
    if (token.length === 1 && ORDINAL_TO_INDEX[token] != null) {
      const index = ORDINAL_TO_INDEX[token]!;
      if (index >= 0 && index < combinationCount) indices.add(index);
    }
  }
  // Soft forms:「第二和第三」「二跟三」without 第 on every token
  for (const match of text.matchAll(/(?:^|[和跟與、,，\s])([一二三四五六七八九十])(?:組|個)?(?=$|[和跟與、,，\s天])/g)) {
    const index = ORDINAL_TO_INDEX[match[1]!]!;
    if (index != null && index >= 0 && index < combinationCount) indices.add(index);
  }
  return [...indices].sort((a, b) => a - b);
}

export function parseCombinationSelectionIndices(
  text: string,
  combinationCount: number,
): number[] {
  const t = text.trim();
  if (!t || combinationCount <= 0) return [];

  // Explicit "all / let Roamie decide" phrases — not silent fallback.
  if (isUserAllOrAutoCombinationReply(t)) {
    return Array.from({ length: combinationCount }, (_, i) => i);
  }

  const indices = new Set<number>();
  for (const match of t.matchAll(/(\d{1,2})/g)) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < combinationCount) indices.add(index);
  }
  for (const index of parseOrdinalCombinationIndices(t, combinationCount)) {
    indices.add(index);
  }
  return [...indices].sort((a, b) => a - b);
}

/** Phrases that mean: select all currently shown combinations / Roamie mix. */
export const USER_ALL_OR_AUTO_COMBINATION_RE =
  /^(可以)?幫我生成$|^(可以)?幫我排$|^都可以$|^都不錯$|^這些都可以$|^這些都不錯$|^你決定$|^Roamie\s*幫我安排$|^幫我安排$|^直接排$|^全部$|^混搭$|都行$|^都行吧$|^就這些$|^就這樣$|^沒問題$/i;

/** Soft accept-all without an explicit generate verb (lock selection only). */
export const SOFT_ACCEPT_ALL_COMBINATIONS_RE =
  /^(都可以|都行|都行吧|都不錯|這些都可以|這些都不錯|就這些|就這樣|沒問題|好呀|好喔|好的|好)$/;

export function isSoftAcceptAllCombinationsReply(text: string): boolean {
  const t = text.trim().replace(/\s+/g, "");
  return SOFT_ACCEPT_ALL_COMBINATIONS_RE.test(t);
}

export function isUserAllOrAutoCombinationReply(text: string): boolean {
  const t = text.trim().replace(/\s+/g, "");
  if (!t) return false;
  if (USER_ALL_OR_AUTO_COMBINATION_RE.test(t)) return true;
  if (isSoftAcceptAllCombinationsReply(t)) return true;
  // 「全部，也想去鎌倉」「全部順便安排箱根」— 全選 + 近郊延伸
  if (/^全部(?:[，,、]|也|都|順便|再|加|跟|和)/.test(t)) return true;
  // Soft variants with light fluff:「那就幫我生成」「可以幫我生成行程」
  if (
    /^(那就|那就請|請|可以)?(幫我|請你)?(生成|排|安排)(行程)?$/.test(t) ||
    /^(Roamie)?幫我(安排|生成|排)(吧|啊|喔)?$/.test(t)
  ) {
    return true;
  }
  return false;
}

export type CombinationSelectionSource =
  | "user_indexed"
  | "user_title"
  | "user_all_or_auto"
  | "all_selected_by_user";

export function resolveSelectedCombinations(
  destination: string,
  text: string,
): {
  titles: string[];
  places: string[];
  indexes: number[];
  selectionSource: CombinationSelectionSource;
} | null {
  const combos = getDestinationCombinations(destination);
  if (!combos.length) return null;

  if (isUserAllOrAutoCombinationReply(text)) {
    const selectionSource: CombinationSelectionSource = isSoftAcceptAllCombinationsReply(text)
      ? "all_selected_by_user"
      : "user_all_or_auto";
    return {
      titles: combos.map((c) => c.title),
      places: [...new Set(combos.flatMap((c) => c.places))],
      indexes: combos.map((_, i) => i),
      selectionSource,
    };
  }

  const indices = parseCombinationSelectionIndices(text, combos.length);
  if (indices.length) {
    const selected = indices.map((i) => combos[i]!).filter(Boolean);
    const places = [...new Set(selected.flatMap((c) => c.places))];
    return {
      titles: selected.map((c) => c.title),
      places,
      indexes: indices,
      selectionSource: "user_indexed",
    };
  }

  const normalizedText = text.replace(/\s+/g, "");
  const byTitleIndexes: number[] = [];
  combos.forEach((combo, index) => {
    const titleKey = combo.title.replace(/\s+/g, "").replace(/組合$/, "");
    const titleTokens = titleKey
      .split(/[／/·・]/)
      .flatMap((chunk) => {
        const parts: string[] = [chunk];
        // Match shorter thematic stems: 文創市集 → 文創; 夜市商圈 → 夜市
        if (chunk.length >= 4) parts.push(chunk.slice(0, 2), chunk.slice(0, 4));
        else if (chunk.length >= 2) parts.push(chunk.slice(0, 2));
        return parts;
      })
      .filter((t) => t.length >= 2);
    if (
      normalizedText.includes(titleKey) ||
      titleTokens.some((token) => normalizedText.includes(token))
    ) {
      byTitleIndexes.push(index);
    }
  });
  if (byTitleIndexes.length) {
    const selected = byTitleIndexes.map((i) => combos[i]!);
    return {
      titles: selected.map((c) => c.title),
      places: [...new Set(selected.flatMap((c) => c.places))],
      indexes: byTitleIndexes,
      selectionSource: "user_title",
    };
  }

  return null;
}

/** Hard allowlist for one generation — unselected-combo-only places must be excluded. */
export type CombinationSelectionAllowlist = {
  selectedCombinationIds: number[];
  selectedCombinationIndexes: number[];
  allowedTitles: string[];
  allowedPlaceNames: string[];
  excludedTitles: string[];
  /** Places that appear only in unselected combinations (never keep these). */
  exclusiveExcludedPlaceNames: string[];
  selectionSource?: CombinationSelectionSource;
};

function normalizePlaceNameKey(name: string): string {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

export function buildCombinationSelectionAllowlist(
  destination: string,
  text: string,
): CombinationSelectionAllowlist | null {
  const label = normalizeDestinationLabel(destination);
  const combos = getDestinationCombinations(label);
  if (!combos.length) return null;

  const resolved = resolveSelectedCombinations(label, text);
  if (!resolved?.indexes.length) return null;

  const selectedSet = new Set(resolved.indexes);
  const selectedCombinationIds = resolved.indexes.map((i) => i + 1);
  const allowedTitles = resolved.titles;

  // Flat-merge selected combination places — never overwrite prior selections.
  const beforeDedup: string[] = [];
  for (const id of selectedCombinationIds) {
    const places = combos[id - 1]?.places ?? [];
    beforeDedup.push(...places);
    logAiPipeline(
      "[COMBINATION_CANDIDATE_COUNTS]",
      `combinationId=${id}`,
      `count=${places.length}`,
    );
  }
  const seenMerge = new Set<string>();
  const allowedPlaceNames: string[] = [];
  for (const place of beforeDedup) {
    const key = normalizePlaceNameKey(place);
    if (!key || seenMerge.has(key)) continue;
    seenMerge.add(key);
    allowedPlaceNames.push(place);
  }
  logAiPipeline(
    "[COMBINATION_CANDIDATE_COUNTS]",
    `mergedBeforeDedup=${beforeDedup.length}`,
    `mergedAfterDedup=${allowedPlaceNames.length}`,
  );
  const allowedKeys = new Set(allowedPlaceNames.map(normalizePlaceNameKey));

  const excludedTitles: string[] = [];
  const exclusiveExcluded = new Set<string>();
  combos.forEach((combo, index) => {
    if (selectedSet.has(index)) return;
    excludedTitles.push(combo.title);
    for (const place of combo.places) {
      if (!allowedKeys.has(normalizePlaceNameKey(place))) {
        exclusiveExcluded.add(place);
      }
    }
  });

  logAiPipeline(
    "[COMBINATION_SELECTION_PARSED]",
    `rawInput=${text.trim()}`,
    `selectedCombinationIds=[${selectedCombinationIds.join(",")}]`,
    `selectionSource=${resolved.selectionSource}`,
  );
  logAiPipeline(
    "[SELECTED_COMBINATION_PARSE_RESULT]",
    `rawText=${JSON.stringify(text.trim())}`,
    `ids=[${selectedCombinationIds.join(",")}]`,
  );
  logAiPipeline(
    "[SELECTED_COMBINATION_CONTEXT_SAVED]",
    `ids=[${selectedCombinationIds.join(",")}]`,
  );

  logAiPipeline(
    "[COMBINATION_ALLOWLIST]",
    `destination=${label}`,
    `selectedIds=${selectedCombinationIds.join(",")}`,
    `selectionSource=${resolved.selectionSource}`,
    `allowed=${allowedPlaceNames.join("|")}`,
    `excludedExclusive=${[...exclusiveExcluded].join("|")}`,
  );

  return {
    selectedCombinationIds,
    selectedCombinationIndexes: resolved.indexes,
    allowedTitles,
    allowedPlaceNames,
    excludedTitles,
    exclusiveExcludedPlaceNames: [...exclusiveExcluded],
    selectionSource: resolved.selectionSource,
  };
}

export function buildCombinationAllowlistFromTitles(
  destination: string,
  titles: string[],
): CombinationSelectionAllowlist | null {
  const label = normalizeDestinationLabel(destination);
  const combos = getDestinationCombinations(label);
  if (!combos.length || !titles.length) return null;

  const titleKeys = titles.map((t) => t.replace(/\s+/g, "").replace(/組合$/, ""));
  const indexes: number[] = [];
  combos.forEach((combo, index) => {
    const key = combo.title.replace(/\s+/g, "").replace(/組合$/, "");
    if (titleKeys.some((t) => t === key || key.includes(t) || t.includes(key))) {
      indexes.push(index);
    }
  });
  if (!indexes.length) return null;

  return buildCombinationSelectionAllowlist(
    label,
    indexes.map((i) => String(i + 1)).join("、"),
  );
}

export function isPlaceNameInCombinationAllowlist(
  placeName: string,
  allowlist: CombinationSelectionAllowlist,
): boolean {
  const key = normalizePlaceNameKey(placeName);
  if (!key) return false;
  if (allowlist.exclusiveExcludedPlaceNames.some((n) => normalizePlaceNameKey(n) === key)) {
    return false;
  }
  return allowlist.allowedPlaceNames.some((n) => {
    const allowed = normalizePlaceNameKey(n);
    return key === allowed || key.includes(allowed) || allowed.includes(key);
  });
}

export function filterPlacesByCombinationAllowlist<T extends { name?: string; placeName?: string }>(
  places: T[],
  allowlist: CombinationSelectionAllowlist | null | undefined,
): T[] {
  if (!allowlist?.allowedPlaceNames.length) return places;
  return places.filter((item) => {
    const name = (item.placeName ?? item.name ?? "").trim();
    return isPlaceNameInCombinationAllowlist(name, allowlist);
  });
}

export function buildCombinationRecommendations(
  destination: string,
  allowlist?: CombinationSelectionAllowlist | null,
): RoamieRecommendationItem[] {
  const label = normalizeDestinationLabel(destination);
  const combos = getDestinationCombinations(label);
  const items: RoamieRecommendationItem[] = [];
  const selectedIndexes = allowlist
    ? new Set(allowlist.selectedCombinationIndexes)
    : null;

  for (let index = 0; index < combos.length; index += 1) {
    if (selectedIndexes && !selectedIndexes.has(index)) continue;
    const combo = combos[index]!;
    for (const place of combo.places) {
      if (!isSuggestionInDestinationScope(place, label)) continue;
      if (isForbiddenTransitAttraction({ name: place })) continue;
      if (
        allowlist &&
        !isPlaceNameInCombinationAllowlist(place, allowlist)
      ) {
        continue;
      }
      items.push(
        normalizeRecommendationItem({
          name: place,
          placeName: place,
          type: "景點",
          description: `${combo.title}推薦`,
          reason: `${combo.title}推薦`,
          reasonSource: "template",
          estimatedTime: "1-2 小時",
          address: label,
          sourceCombinationId: index + 1,
          matchedCombinationIds: [index + 1],
          matchedSelectedCombinationIds: allowlist
            ? [index + 1]
            : undefined,
        }),
      );
    }
  }

  return items;
}

/** 組合推薦失敗時，退回 flatten 後的簡單 destination suggestions */
export function buildSafeCombinationRecommendations(
  destination: string,
  allowlist?: CombinationSelectionAllowlist | null,
): RoamieRecommendationItem[] {
  try {
    return buildCombinationRecommendations(destination, allowlist);
  } catch (error) {
    console.warn(
      "[CHAT_COMBINATION_RECOMMENDATIONS_FALLBACK]",
      error instanceof Error ? error.message : String(error),
    );
    const label = normalizeDestinationLabel(destination);
    const names = allowlist?.allowedPlaceNames?.length
      ? allowlist.allowedPlaceNames
      : flattenDestinationCombinationPlaces(label);
    return names.map((place) =>
      normalizeRecommendationItem({
        name: place,
        placeName: place,
        type: "景點",
        description: "建議組合",
        reason: "建議組合",
        reasonSource: "template",
        estimatedTime: "1-2 小時",
        address: label,
      }),
    );
  }
}

export function hasDestinationPlanningBasics(ctx: {
  destination?: string;
  days?: number;
  tripDays?: number;
  startDate?: string;
  endDate?: string;
}): boolean {
  return Boolean(
    ctx.destination?.trim() &&
      hasValidTripDuration({
        days: ctx.days,
        tripDays: ctx.tripDays,
        startDate: ctx.startDate,
        endDate: ctx.endDate,
      }),
  );
}
