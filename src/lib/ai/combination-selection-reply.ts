/**
 * Combination-choice 回覆角色解析（Step 1 對話接線）
 *
 * 「1、2跟橫濱」→ selectedCombinationIds + nearbyExtensions
 * 「改去橫濱」→ explicit primary destination switch
 *
 * 不改 Recommendation / Planner 排序邏輯。
 */
import {
  isUserAllOrAutoCombinationReply,
  parseCombinationSelectionIndices,
} from "@/lib/ai/destination-combination-suggestions";
import {
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";
import { listNearbyRegionVocabulary } from "@/lib/ai/region-adjacency";

/** 明確替換主要目的地（非近郊延伸） */
const EXPLICIT_PRIMARY_SWITCH_RE =
  /(?:改去|改成去|換成去|目的地(?:改成|換成)|不要去[\u4e00-\u9fffA-Za-z]{2,12}了?[，,]?\s*(?:改)?去)/i;

const EXPLICIT_SWITCH_CAPTURE_RE =
  /(?:改去|改成去|換成去|目的地(?:改成|換成))\s*([\u4e00-\u9fffA-Za-z]{2,20})/i;

/**
 * Legacy fallback labels when primary is unknown.
 * Prefer `listNearbyRegionVocabulary(primary)` so utterance matching
 * follows Region Adjacency for the active destination.
 */
const NEARBY_EXTENSION_LABELS_FALLBACK = [
  "橫濱",
  "横浜",
  "Yokohama",
  "鎌倉",
  "箱根",
  "輕井澤",
  "河口湖",
  "富士山",
  "日光",
  "千葉",
  "川崎",
  "大宮",
  "埼玉",
  "熱海",
  "伊豆",
  "犬山",
  "常滑",
  "瀨戶",
  "瀬戸",
  "岡崎",
  "一宮",
  "岐阜",
  "九份",
  "淡水",
  "北投",
  "基隆",
  "桃園",
  "新北",
  "宜蘭",
  "花蓮",
  "台中",
  "臺中",
  "台南",
  "臺南",
  "高雄",
  "濟州",
  "釜山",
  "仁川",
  "水原",
  "城南",
  "大阪",
  "京都",
  "奈良",
  "神戶",
  "白濱",
  "白浜",
  "箱根",
  "伊勢",
].sort((a, b) => b.length - a.length);

export type CombinationSelectionReplyParse = {
  /** 1-based combination ids；空陣列表示「全部／幫我決定」以外的無編號回覆 */
  selectedCombinationIds: number[];
  nearbyExtensions: string[];
  isExplicitDestinationSwitch: boolean;
  switchDestination?: string;
  /** 是否為組合選擇延續（含編號／全部／標題式） */
  isCombinationContinuation: boolean;
};

export function isExplicitPrimaryDestinationSwitch(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return EXPLICIT_PRIMARY_SWITCH_RE.test(t);
}

export function parseExplicitPrimaryDestinationSwitch(
  text: string,
): string | undefined {
  const t = text.trim();
  if (!t || !isExplicitPrimaryDestinationSwitch(t)) return undefined;
  const m = t.match(EXPLICIT_SWITCH_CAPTURE_RE);
  const raw = m?.[1]?.trim();
  if (!raw) return undefined;
  const label = normalizeDestinationLabel(raw.replace(/[,，].*$/, "").trim());
  return isKnownTouristCityLabel(label) || label.length >= 2 ? label : undefined;
}

function nearbyExtensionLabelsForPrimary(primaryDestination?: string): string[] {
  if (!primaryDestination?.trim()) return NEARBY_EXTENSION_LABELS_FALLBACK;
  const fromGraph = listNearbyRegionVocabulary(primaryDestination);
  if (!fromGraph.length) return NEARBY_EXTENSION_LABELS_FALLBACK;
  // Merge fallback so older utterances (箱根…) still parse, then dedupe by length.
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const label of [...fromGraph, ...NEARBY_EXTENSION_LABELS_FALLBACK]) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(label);
  }
  return merged.sort((a, b) => b.length - a.length);
}

/** 從回覆抽出近郊延伸地，排除 primaryDestination。 */
export function parseNearbyExtensionsFromText(
  text: string,
  primaryDestination?: string,
): string[] {
  const t = text.trim();
  if (!t) return [];
  const primary = primaryDestination
    ? normalizeDestinationLabel(primaryDestination)
    : "";
  const found: string[] = [];
  const seen = new Set<string>();

  const lower = t.toLowerCase();
  for (const label of nearbyExtensionLabelsForPrimary(primaryDestination)) {
    if (!t.includes(label) && !lower.includes(label.toLowerCase())) continue;
    const normalized = normalizeDestinationLabel(label);
    if (!normalized || (primary && normalized === primary)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    found.push(normalized);
  }

  return found;
}

/**
 * 解析組合選擇回覆角色。
 * combinationCount：目前 offered 組合數；未知時用 8 作為上限以抽取編號。
 */
export function parseCombinationSelectionReply(
  text: string,
  opts: {
    combinationCount?: number;
    primaryDestination?: string;
  } = {},
): CombinationSelectionReplyParse {
  const t = text.trim();
  const combinationCount = Math.max(1, opts.combinationCount ?? 8);
  const primary = opts.primaryDestination
    ? normalizeDestinationLabel(opts.primaryDestination)
    : undefined;

  const switchDestination = parseExplicitPrimaryDestinationSwitch(t);
  if (switchDestination) {
    return {
      selectedCombinationIds: [],
      nearbyExtensions: [],
      isExplicitDestinationSwitch: true,
      switchDestination,
      isCombinationContinuation: false,
    };
  }

  const indices = parseCombinationSelectionIndices(t, combinationCount);
  // 「全部，也想去鎌倉」— 非嚴格 ^全部$，但仍是全選 + 近郊
  const allOrAuto =
    isUserAllOrAutoCombinationReply(t) ||
    /(?:^|[，,、\s])全部(?:[，,、\s]|也|都|$)/.test(t) ||
    /^(都|這些)?都可以/.test(t.replace(/\s+/g, ""));
  const selectedCombinationIds = allOrAuto
    ? Array.from({ length: combinationCount }, (_, i) => i + 1)
    : indices.map((i) => i + 1);

  const nearbyExtensions = parseNearbyExtensionsFromText(t, primary);
  const isCombinationContinuation =
    selectedCombinationIds.length > 0 ||
    allOrAuto ||
    // 「選 3，順便安排箱根」— 有編號或延伸地 + 選／組合語意
    (nearbyExtensions.length > 0 &&
      /(?:選|选|組合|组合|第[一二三四五六七八九十\d]|全部|都行)/.test(t));

  return {
    selectedCombinationIds,
    nearbyExtensions,
    isExplicitDestinationSwitch: false,
    isCombinationContinuation:
      isCombinationContinuation ||
      (nearbyExtensions.length > 0 && selectedCombinationIds.length > 0),
  };
}

/** 進行中的 combination_choice（或已有 offered combos）且回覆為延續，非明確換目的地。 */
export function isCombinationSelectionContinuationReply(
  text: string,
  opts: {
    pendingType?: string;
    primaryDestination?: string;
    combinationCount?: number;
    hasOfferedCombinations?: boolean;
  },
): boolean {
  if (isExplicitPrimaryDestinationSwitch(text)) return false;
  const pendingOk =
    opts.pendingType === "combination_choice" ||
    Boolean(opts.hasOfferedCombinations);
  if (!pendingOk) return false;

  const parsed = parseCombinationSelectionReply(text, {
    combinationCount: opts.combinationCount,
    primaryDestination: opts.primaryDestination,
  });
  return parsed.isCombinationContinuation;
}
