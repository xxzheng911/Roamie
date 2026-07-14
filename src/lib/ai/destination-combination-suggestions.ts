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
import { isGenericDestinationPlaceholder } from "@/lib/ai/generic-place-label";
import {
  INSUFFICIENT_COMBINATION_PLACES_MESSAGE,
  validateCombinationOptions,
  type StructuredCombinationOption,
} from "@/lib/ai/destination-combination-discovery";

export type DestinationCombination = {
  title: string;
  places: string[];
};

export { INSUFFICIENT_COMBINATION_PLACES_MESSAGE, isGenericDestinationPlaceholder };

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

export function getDestinationCombinations(destination: string): DestinationCombination[] {
  const label = normalizeDestinationLabel(destination);
  const combos = buildDynamicDestinationCombinations(label)
    .map((combo) => ({
      title: combo.title,
      places: combo.places.filter(
        (place) =>
          isSuggestionInDestinationScope(place, destination) &&
          !isGenericDestinationPlaceholder(place, label) &&
          !isForbiddenTransitAttraction({ name: place }),
      ),
    }))
    .filter((combo) => combo.places.length >= 2);

  const validation = validateCombinationOptions(
    toStructuredForValidation(label, combos),
    label,
  );
  if (!validation.ok) {
    if (validation.genericPlaceNames.length) {
      return [];
    }
    // Curated profiles with >=3 valid combos may fail strict overlap checks; still allow.
    if (combos.length >= 3 && !validation.reason?.includes("generic")) {
      return combos;
    }
    return [];
  }
  return combos;
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
  return getDestinationCombinations(label).map((combo, index) => ({
    id: index + 1,
    title: combo.title,
    places: combo.places.map((name) => ({
      name,
      searchQuery: `${name} ${label}`,
      sourceCombinationId: index + 1,
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
): string | null {
  const start = formatDisplayDate(startDate);
  const end = formatDisplayDate(endDate);
  if (start && end) return `旅行日期：${start}～${end}`;
  if (start) return `旅行日期：${start}`;
  return null;
}

export function buildDestinationCombinationSuggestionsReply(
  destination: string,
  days: number,
  opts?: { startDate?: string; endDate?: string; weatherLine?: string | null },
): string | null {
  const label = normalizeDestinationLabel(destination);
  const combos = getDestinationCombinations(label);
  if (!combos.length) return null;

  // Structured data only — never surface AI-invented category placeholders.
  for (const combo of combos) {
    for (const place of combo.places) {
      if (isGenericDestinationPlaceholder(place, label)) {
        logAiPipeline(
          "[COMBINATION_VALIDATION_FAILED]",
          "reason=generic_in_reply_builder",
          `genericPlaceNames=[${place}]`,
        );
        return null;
      }
    }
  }

  if (combos.length < 3) {
    // Reply builder may be called each render — do not spam identical failure logs.
    return null;
  }

  logChatDestinationScopeLock(label);

  const dateLine = formatTravelDateRangeLine(opts?.startDate, opts?.endDate);

  const header = [
    opts?.weatherLine?.trim() || `好，我先記下 ${label} ${days} 天行程方向。`,
    "",
    `以下是${label}的建議組合搭配，你可以選一組或多組混搭：`,
    "",
    ...combos.map((combo, index) => `${index + 1}. ${combo.title}：${combo.places.join("、")}`),
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
  startDate?: string;
}): boolean {
  return Boolean(ctx.destination?.trim() && ctx.days && ctx.days > 0);
}
