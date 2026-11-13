import { localizedCountryReference } from "./destination-country-normalize";
import { isCalendarOnly } from "./planning-calendar-signals";
import { safeDestinationCandidate, travelDestinationCandidates } from "./travel-language-signals";
import { multilingualTravelIntent } from "@/lib/ai/travel-language-signals";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { TripLocation } from "@/lib/location/types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { isTravelPlanningText } from "@/lib/ai/chat-intent-router";
import type { TripIntentMissingKey } from "@/lib/recommendation/trip-intent";
import {
  isTripAddPlaceSession,
  reinforceTripAddPlaceSession,
} from "@/lib/trip/trip-add-place-session";
import { buildDestinationStyleChoiceQuestion } from "@/lib/ai/destination-style-guide";
import { chatRuntimeCopy } from "@/lib/chat-runtime-copy";
import type { Locale } from "@/lib/i18n/types";
import {
  isBestSeasonQuestion,
} from "@/lib/ai/season-response-guardrail";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import { mapPlaceLabelToGoogleType } from "@/lib/affiliate/place-type-category-map";
import { isComboItineraryQuery } from "@/lib/ai/chat-category-place-guard";
import { extractItineraryDestinationFromText } from "@/lib/ai/itinerary-entity-extraction";
import { enrichTripDatesInContext } from "@/lib/ai/ai-trip-style";
import { applyCityLocaleAlias, extractKnownAliasDestination } from "@/lib/ai/destination-locale-aliases";
import { normalizeDestinationAndDuration } from "@/lib/parse-chinese-duration";
import {
  isContinuationGrammarOnly,
  matchLeadingNegatedClause,
  negatedClauseSwitchedText,
  parseNegatedDestinationSwitch,
} from "@/lib/ai/continue-recommendation-intent";

/** A 附近探索 | B 目的地規劃 | C 特定地點 | D 心情推薦 */
export type ChatConversationMode =
  | "nearby_explore"
  | "destination_planning"
  | "place_focus"
  | "mood_recommend"
  | "trip_add_place"
  | "general";

export type TripPlanningContext = {
  destination?: string;
  origin?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  budget?: string;
  travelStyle?: string;
  transportation?: string;
  peopleCount?: number;
  travelMonth?: string;
  selectedPlaces: string[];
  intent: ChatConversationMode;
};

export const EMPTY_TRIP_PLANNING_CONTEXT: TripPlanningContext = {
  selectedPlaces: [],
  intent: "general",
};

const KNOWN_CITIES =
  /^(台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|苗栗|南投|彰化|雲林|屏東|屏东|嘉義|花蓮|台東|臺東|宜蘭|澎湖|金門|馬祖|連江|京都|大阪|東京|橫濱|名古屋|福岡|首爾|釜山|香港|澳門|新加坡|曼谷|清邁|巴黎|倫敦|愛丁堡|曼徹斯特|湖區|紐約|洛杉磯|舊金山|雪梨|墨爾本|深圳|廣州|上海|北京|巴塞隆納|峴港)(市|縣|都|府)?$/i;

/** 熱門旅遊城市（含泰國海島等） */
const KNOWN_TOURIST_CITIES =
  /^(芭達雅|芭堤雅|巴達雅|帕塔雅|普吉島|普吉|蘇梅島|蘇梅|清邁|清迈|河內|胡志明|峴港|金邊|吳哥窟|吉隆坡|檳城|槟城|峇里島|峇厘島|巴厘岛|巴里島|宿霧|長灘島|長灘|馬尼拉|巴拉望|札幌|北海道|沖繩|冲绳|廣島|広島|熊本|長崎|鹿兒島|仙台|金澤|松本|高山|函館|小樽|奈良|神戶|神戸|箱根|鎌倉|輕井澤|白川鄉|佛羅倫斯|翡冷翠|濟州|濟州島|慶州|江陵|阿里山|日月潭|墾丁|塔斯馬尼亞|深圳|廣州|上海|北京|巴塞隆納)(市|府|島|县|縣)?$/i;

/** 知名景點／山岳／風景區（非城市但為明確旅遊目的地） */
const KNOWN_SCENIC_SPOTS =
  /^(阿里山|日月潭|太魯閣|清境|墾丁|九份|玉山|武陵|合歡山|溪頭|杉林溪|野柳|十分|平溪|貓空|陽明山|象山|龜山島|蘭嶼|綠島|七股|北投|淡水|礁溪|知本|池上|高美濕地|福壽山|奧萬大|雪霸|富士山|河口湖|輕井澤|白川鄉|合掌村|吴哥窟|吳哥窟)(?:國家(?:風景|风景)區|風景(?:區|区)|森林(?:遊樂|游乐)區|國家公園|国家公园)?$/i;

const DESTINATION_ALIASES: Record<string, string> = {
  帕塔雅: "芭達雅",
  芭堤雅: "芭達雅",
  巴達雅: "芭達雅",
  Pattaya: "芭達雅",
  pattaya: "芭達雅",
  "Pattaya City": "芭達雅",
  "pattaya city": "芭達雅",
  พัทยา: "芭達雅",
  清迈: "清邁",
  普吉: "普吉島",
  苏梅: "蘇梅島",
  苏梅岛: "蘇梅島",
  巴厘岛: "峇里島",
  峇厘島: "峇里島",
  巴里島: "峇里島",
  冲绳: "沖繩",
  槟城: "檳城",
  長灘: "長灘島",
  濟州島: "濟州",
  横浜: "橫濱",
  横濱: "橫濱",
  Yokohama: "橫濱",
  yokohama: "橫濱",
  Hakone: "箱根",
  hakone: "箱根",
  Kamakura: "鎌倉",
  kamakura: "鎌倉",
  Phuket: "普吉島",
  phuket: "普吉島",
  "Koh Samui": "蘇梅島",
  "Ko Samui": "蘇梅島",
  Bali: "峇里島",
  bali: "峇里島",
  Hokkaido: "北海道",
  hokkaido: "北海道",
  Okinawa: "沖繩",
  okinawa: "沖繩",
  Jeju: "濟州",
  jeju: "濟州",
};

/**
 * Same Han place name up to 臺／台, 區／区 and one trailing 區／区 / 市 (海雲臺區 = 海雲台). At least two
 * Han characters remain on both sides; never a substring match.
 */
export function sameHanPlaceVariant(left: string | undefined, right: string | undefined): boolean {
  const fold = (value: string | undefined) => {
    const t = (value ?? "").trim().replace(/臺/g, "台").replace(/區/g, "区");
    if (!/^\p{Script=Han}+$/u.test(t)) return "";
    const stem = t.length > 2 ? t.replace(/(?:区|市)$/, "") : t;
    return stem.length >= 2 ? stem : "";
  };
  const a = fold(left);
  return Boolean(a) && a === fold(right);
}

export function normalizeDestinationLabel(name: string): string {
  const durationNormalized = normalizeDestinationAndDuration(name);
  const stripped = normalizeCityLabel(durationNormalized.destinationLabel).replace(/\s+city$/i, "").trim();
  const aliased = DESTINATION_ALIASES[stripped] ?? DESTINATION_ALIASES[stripped.toLowerCase()];
  if (aliased) return aliased;
  return applyCityLocaleAlias(stripped);
}

export function isKnownTouristCityLabel(name: string): boolean {
  const n = normalizeDestinationLabel(name);
  return KNOWN_CITIES.test(n) || KNOWN_TOURIST_CITIES.test(n);
}

export type KnownParentAreaSplit = {
  parentCity: string;
  area: string;
};

const STRUCTURED_AREA_TAIL_RE =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]+$/u;
const INVALID_STRUCTURED_AREA_TAIL =
  /^(?:附近|周邊|周边|市區|市区|當地|当地|這裡|这里|那裡|那里|有|的|之)$/;
const INVALID_STRUCTURED_AREA_SUBSTRING =
  /(?:安靜|安静|熱鬧|热闹|便宜|高級|高级|不限時|不限时|更多|其他|還有|还有|一點|一点|一些|更好|插座|甜點|甜点)/;

/** The single activity-tail rule (「玩」「走走」「玩兩天」「三天」); anchored on the whole tail. */
const NON_GEOGRAPHIC_ACTIVITY_TAIL_RE =
  /^(?:(?:走走|逛逛|玩玩|玩|旅行|旅遊|旅游)(?:(?:[一二三四五六七八九十兩两]{1,3}|\d{1,2})\s*(?:天|日))?|(?:[一二三四五六七八九十兩两]{1,3}|\d{1,2})\s*天)$/;

/**
 * True when the whole tail is an activity (+ optional day count) or a bare 「N天」, never a
 * geographic area (「金澤玩」→「玩」, 「福岡玩兩天」→「玩兩天」). Pure; the only activity-tail rule.
 */
export function isNonGeographicActivityTail(tail: string): boolean {
  return NON_GEOGRAPHIC_ACTIVITY_TAIL_RE.test(tail);
}

export type TrailingActivityTailSplit =
  | { kind: "none" }
  | { kind: "activity_only" }
  | { kind: "invalid_head"; tail: string }
  | { kind: "split"; head: string; tail: string };

/**
 * Shared trailing activity-tail split (no own pattern; only isNonGeographicActivityTail):
 * whole text is an activity tail → activity_only; else the longest activity-tail suffix wins
 * (first hit stops) → split when the head has ≥2 chars and is no activity tail, otherwise
 * invalid_head; no suffix → none. Does not guess a place name.
 */
export function splitTrailingActivityTail(raw: string): TrailingActivityTailSplit {
  const t = (raw ?? "").trim();
  if (!t) return { kind: "none" };
  if (isNonGeographicActivityTail(t)) return { kind: "activity_only" };
  for (let len = t.length - 1; len >= 1; len -= 1) {
    const tail = t.slice(t.length - len);
    if (!isNonGeographicActivityTail(tail)) continue;
    const head = t.slice(0, t.length - len).trim();
    if (head.length >= 2 && !isNonGeographicActivityTail(head)) {
      return { kind: "split", head, tail };
    }
    return { kind: "invalid_head", tail };
  }
  return { kind: "none" };
}

/** Sentence-initial pronoun set (same literals as the cri extended negated clause). */
const LEADING_PRONOUN = "(?:我們|我们|那我|那就|我|那|就|還是|还是|先)";
const LEADING_PRONOUN_ONLY_RE = new RegExp(`^${LEADING_PRONOUN}$`);
const KNOWN_CITY_ACTIVITY_PHRASE_RE = new RegExp(
  `^${LEADING_PRONOUN}?(?:(?:想|要)?[去到在])?([\\u4e00-\\u9fff]{2,8}?)` +
    "((?:走走|逛逛|玩玩|玩|旅行|旅遊|旅游)(?:(?:[一二三四五六七八九十兩两]{1,3}|\\d{1,2})\\s*(?:天|日))?)" +
    "(?=推薦|推荐|有|景點|景点|地點|地点|吃|喝|，|,|。|！|!|？|\\?|\\s|$)",
);

/**
 * Additive fallback after the existing parse patterns: sentence-initial (pronoun)?(想/要)?去／到／在?
 * + local known city + activity tail (「去金澤玩推薦咖啡廳」「到金澤玩，…」→ 金澤; 「到處玩」→ none,
 * the label must be a known city as a whole). Never runs on a negated
 * clause; non-local places are left to the provisional split (no unverified write).
 */
function matchKnownCityActivityPhrase(t: string): string | undefined {
  if (matchLeadingNegatedClause(t) !== null) return undefined;
  const m = t.match(KNOWN_CITY_ACTIVITY_PHRASE_RE);
  if (!m?.[1] || !m[2]) return undefined;
  if (!isNonGeographicActivityTail(m[2])) return undefined;
  const label = normalizeDestinationLabel(m[1]);
  return isKnownTouristCityLabel(label) ? label : undefined;
}

/**
 * Known parent city/county/region + adjacent geographic tail.
 * City-wide labels have no tail. One-character tails (東京港) are allowed;
 * they stay untrusted until provider validation.
 */
export function splitKnownParentAreaLabel(input: string): KnownParentAreaSplit | null {
  const compact = normalizeDestinationLabel(input).replace(/[\s,，、/／-]+/g, "");
  if (!compact) return null;
  const maxLen = Math.min(8, compact.length - 1);
  for (let len = maxLen; len >= 2; len -= 1) {
    const prefix = compact.slice(0, len);
    const parentCity = normalizeDestinationLabel(prefix);
    if (!isKnownTouristCityLabel(parentCity)) continue;
    const area = compact
      .slice(len)
      .replace(/^[市縣县都府]/, "")
      .replace(/^(?:的|之)/, "");
    if (!area || area.length > 8) continue;
    if (isNonGeographicActivityTail(area)) continue;
    if (/^有/.test(area) || INVALID_STRUCTURED_AREA_TAIL.test(area)) continue;
    if (INVALID_STRUCTURED_AREA_SUBSTRING.test(area)) continue;
    if (!STRUCTURED_AREA_TAIL_RE.test(area)) continue;
    return { parentCity, area };
  }
  return null;
}

export function isKnownScenicLabel(name: string): boolean {
  const n = normalizeDestinationLabel(name);
  return KNOWN_SCENIC_SPOTS.test(n);
}

export function isKnownDestinationLabel(name: string): boolean {
  return isKnownTouristCityLabel(name) || isKnownCountryLabel(name) || isKnownScenicLabel(name);
}

export const KNOWN_COUNTRIES =
  /^(泰國|泰国|日本|韓國|韩国|中國|中国|台灣|台湾|馬來西亞|马来西亚|越南|印尼|印度尼西亞|菲律宾|菲律賓|新加坡|柬埔寨|寮國|老挝|緬甸|缅甸|蒙古|美國|美国|加拿大|英國|英国|法國|法国|德國|德国|義大利|意大利|澳洲|澳大利亚|紐西蘭|新西兰|荷蘭|荷兰|西班牙|葡萄牙|希臘|希腊|瑞士|比利時|比利时|奧地利|奥地利|瑞典|挪威|丹麥|丹麦|芬蘭|芬兰|波蘭|波兰|捷克|匈牙利|愛爾蘭|爱尔兰|冰島|冰岛|土耳其|印度|南非|巴西|阿根廷|智利|墨西哥|埃及|摩洛哥)(國|国)?$/i;

export function isKnownCountryLabel(name: string): boolean {
  const n = normalizeCityLabel(name);
  return KNOWN_COUNTRIES.test(n) || Boolean(localizedCountryReference(n));
}

const KNOWN_COUNTRY_NAMES = [
  "印度尼西亞",
  "馬來西亞",
  "菲律宾",
  "菲律賓",
  "紐西蘭",
  "新西兰",
  "澳大利亚",
  "澳洲",
  "意大利",
  "義大利",
  "德国",
  "德國",
  "法国",
  "法國",
  "英国",
  "英國",
  "美国",
  "美國",
  "加拿大",
  "新加坡",
  "柬埔寨",
  "缅甸",
  "緬甸",
  "老挝",
  "寮國",
  "越南",
  "印尼",
  "泰国",
  "泰國",
  "韩国",
  "韓國",
  "中国",
  "中國",
  "台湾",
  "台灣",
  "日本",
  "蒙古",
] as const;

function matchLeadingKnownDestination(text: string): string | undefined {
  const generic = matchGenericLeadingDestination(text);
  if (generic) return generic;

  const sorted = [...KNOWN_COUNTRY_NAMES].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (text.startsWith(name)) {
      const normalized = normalizeDestinationLabel(name);
      if (isKnownCountryLabel(normalized)) return normalized;
    }
  }

  const prefix = text.match(/^[\u4e00-\u9fff]{2,8}/)?.[0];
  if (prefix) {
    for (let len = Math.min(8, prefix.length); len >= 2; len -= 1) {
      const candidate = normalizeDestinationLabel(prefix.slice(0, len));
      if (isKnownTouristCityLabel(candidate)) return candidate;
    }
  }

  return undefined;
}

/** 從「泰國幾月去比較好」「日本11月適合去哪」等句首擷取目的地 */
export function parseLeadingDestinationLabel(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const englishDuration = t.match(
    /^([A-Za-z][A-Za-z .'-]{1,40}?)\s+(?:for\s+)?\d+\s*(?:-\s*)?days?(?:\s+trip)?$/i,
  );
  if (englishDuration?.[1]) {
    const label = normalizeDestinationLabel(englishDuration[1]);
    if (isValidParsedDestinationLabel(label)) return label;
  }

  if (/(幾月|哪個月|什麼時候|什麼去|什么去|何时|何時|最佳|好玩|比較好|比较好)/.test(t)) {
    const prefix = matchLeadingKnownDestination(t);
    if (prefix && isValidParsedDestinationLabel(prefix)) return prefix;
  }

  const countryMonth =
    t.match(/^([\u4e00-\u9fff]{2,8})(?:的)?(?:幾月|哪個月|什麼時候|何时|何時)/) ??
    t.match(/^([\u4e00-\u9fff]{2,8})(\d{1,2})\s*月/);
  if (countryMonth?.[1]) {
    const label = normalizeCityLabel(countryMonth[1]);
    if (isValidParsedDestinationLabel(label)) {
      return label;
    }
  }

  const cityDays = t.match(/^([\u4e00-\u9fff]{2,8})\s*(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天/);
  if (cityDays?.[1]) {
    const label = normalizeCityLabel(cityDays[1]);
    if (
      isValidParsedDestinationLabel(label) &&
      (isKnownTouristCityLabel(label) || isKnownCountryLabel(label) || isKnownScenicLabel(label))
    ) {
      return label;
    }
  }

  return undefined;
}

/** 「幾月去比較好」「11月適合去哪」「下個月阿里山幾號好」等 — 非附近推薦 */
export function isDestinationAdviceText(text: string): boolean {
  const t = text.trim();
  if (!t || isNearbyExploreText(text)) return false;

  // 已指定目的地 + 出發月份，且非追問最佳季節 → 走旅遊規劃，不是季節諮詢
  if (
    resolveDestinationFromText(t) &&
    /(?:下個月|下个月|下月|這個月|这个月|本月|\d{1,2}\s*月)/.test(t) &&
    /(?:想|要)?去/.test(t) &&
    !isBestSeasonQuestion(t)
  ) {
    return false;
  }

  if (
    /(幾月|几月|哪個月|什么時候|什麼時候|什麼去|什么去|何时|何時|幾號|几号|哪一天|哪天|哪日|下個月|下个月|這個月|这个月|下月|本月|花季|最佳.{0,4}季|最佳.{0,4}(?:時間|时间|日期))/.test(
      t,
    ) &&
    /(比較好|比较好|適合|适合|去|旅遊|旅游|好玩|好|你覺得|觉得|走走|逛逛)/.test(t)
  ) {
    return true;
  }

  if (/(幾號|几号|哪一天|哪天|你覺得.{0,8}好)/.test(t) && parseDestinationFromText(t)) {
    return true;
  }

  if (/\d{1,2}\s*月/.test(t) && /(適合|适合).*(去哪|哪裡|哪里|推薦|推荐)/.test(t)) {
    return true;
  }

  if (
    /[\u4e00-\u9fff]{2,8}\s*(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天.*(怎麼排|行程|規劃|规划|安排)/.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

/** 「我想去泰國」「我想去東京」— 選定目的地、非季節諮詢 */
export function isDestinationSelectionText(text: string): boolean {
  const t = text.trim();
  if (!t || isNearbyExploreText(text) || isDestinationAdviceText(text)) return false;
  if (!/^(?:我)?(?:想)?去/.test(t)) return false;
  return Boolean(parseDestinationFromText(t) || parseDestinationSelectionFromText(t));
}

/**
 * Future trip narrative: time/season + destination + travel verb.
 * Must beat cuisine/place false positives (e.g. bare「越南」≠ Vietnamese food).
 */
export function isFutureTripPlanningStatement(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // 「我想去博物館」"I want to go to a museum": a category wish names no trip destination.
  if (categorySwitchSearchText(t)) return false;

  if (multilingualTravelIntent(t)) return true;
  // Explicit place-category asks are not trip planning narratives.
  if (
    /(?:推薦|有沒有|有什麼|哪些|想找|找).{0,10}(?:餐廳|咖啡|景點|美食|夜市|酒吧|商圈|店)/.test(t) ||
    /(?:餐廳|咖啡廳|咖啡店|景點|美食|夜市).{0,8}(?:推薦|有沒有|有什麼|哪些)/.test(t)
  ) {
    return false;
  }

  const dest =
    parseDestinationFromText(t) ||
    parseDestinationSelectionFromText(t) ||
    resolveDestinationFromText(t);
  if (!dest) return false;

  const hasTimeOrSeason =
    /(?:\d{1,2}\s*月|下個月|下个月|這個月|这个月|明年|後年|暑假|寒假|春節|過年|黃金週|連假|春天|夏天|秋天|冬天)/.test(
      t,
    ) || /(?:\d+|[一二三四五六七八九十兩两]+)\s*天/.test(t);
  const hasTravelVerb = /(?:要去|想去|去|安排|規劃|规划|旅行|旅遊|旅游|玩)/.test(t);

  if (hasTimeOrSeason && hasTravelVerb) return true;
  if (/(?:安排|規劃|规划)/.test(t) && /(?:\d+|[一二三四五六七八九十兩两]+)\s*天/.test(t)) {
    return true;
  }
  if (/(?:明年|後年|暑假|寒假)/.test(t) && /(?:想去|要去|去)/.test(t)) return true;
  return false;
}

/** 「越南有哪些城市適合第一次去」— country → city/region advice, not place cards */
export function isCountryCityInquiryText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const dest = resolveDestinationFromText(t) || parseDestinationFromText(t);
  if (!dest) return false;
  return (
    /(?:有哪些|哪些|推薦).{0,8}(?:城市|地區|區域|旅行區|地方)/.test(t) ||
    /(?:適合第一次|第一次去|第一次).{0,10}(?:城市|地區|去哪)/.test(t) ||
    /(?:城市|地區).{0,8}(?:適合第一次|推薦|值得)/.test(t)
  );
}

export function isDestinationAdviceActive(session: ChatPlanningSession): boolean {
  const purpose = session.travelContext?.tripPurpose;
  return (
    session.activeChatIntent === "destination_advice" ||
    purpose === "best_time_to_visit" ||
    purpose === "seasonal_destination" ||
    purpose === "itinerary_planning" ||
    purpose === "region_selected" ||
    purpose === "destination_selection" ||
    purpose === "route_combination_selected" ||
    purpose === "trip_style_selected" ||
    purpose === "duration_selected" ||
    purpose === "option_selected"
  );
}

/** 需求詞、類別詞、偏好詞 — 不可當目的地 */
const CATEGORY_NON_DESTINATION_LABELS = new Set([
  "吃的地方",
  "玩的地方",
  "去的地方",
  "看的地方",
  "美食",
  "餐廳",
  "餐厅",
  "咖啡廳",
  "咖啡店",
  "咖啡",
  "景點",
  "景点",
  "逛街",
  "放鬆",
  "放松",
  "散步",
  // 「今天不去了，我要去休息」: rest / surfing are activities, never a destination.
  "休息",
  "衝浪",
  "冲浪",
  "shopping",
  "food",
  "cafe",
  "café",
  "夜市",
  "商圈",
  "酒吧",
  "室內",
  "室内",
  // 「不去海邊了，改去博物館」"instead of the beach, museums": categories, never a destination.
  "博物館",
  "博物馆",
  "美術館",
  "美术馆",
  "海邊",
  "海边",
  "海灘",
  "海滩",
  "museum",
  "museums",
  "beach",
  "beaches",
  "박물관",
  "해변",
]);

const NON_DESTINATION_LABELS = new Set([
  "哪裡",
  "哪里",
  "哪兒",
  "哪儿",
  "何處",
  "何处",
  "附近",
  "這裡",
  "这里",
  "那裡",
  "那里",
  "這邊",
  "这边",
  "那邊",
  "那边",
  "什麼地方",
  "什么地方",
  "去哪裡",
  "去哪里",
  "去哪",
  "去哪兒",
  "去哪儿",
  "適合",
  "适合",
  "看看",
  "推薦",
  "推荐",
  "幫我",
  "帮我",
  "比較好",
  "比较好",
  "好不好",
  "幾月",
  "何时",
  "何時",
  "什麼時候",
  "什么时候",
]);

export function normalizeCityLabel(name: string): string {
  const t = name.trim();
  // 京都 ends with 都 but is the full city name — do not strip.
  if (t === "京都") return "京都";
  // 東京都 → 東京 (administrative suffix)
  if (t === "東京都" || t === "东京都") return "東京";
  // 別府・甲府・成都: a two-character name ending in 府 / 都 / 縣 is the name itself (never one character).
  // 「津市」「堺市」 keep the 市 rule (→ 津 / 堺), so a typed 「津」 and a geocoded 「津市」 match.
  if (t.length <= 2 && !t.endsWith("市")) return t;
  return t.replace(/(市|縣|都|府)$/, "");
}

/** 需求／類別／偏好片語 — 不可當目的地 */
export function isCategoryNonDestinationLabel(name: string): boolean {
  const raw = name.trim();
  if (!raw) return true;
  const n = normalizeDestinationLabel(raw);
  const lower = n.toLowerCase();
  if (CATEGORY_NON_DESTINATION_LABELS.has(n)) return true;
  if (CATEGORY_NON_DESTINATION_LABELS.has(lower)) return true;
  if (/的地方$/.test(n) && n.length <= 8) return true;
  if (/^(吃|喝|玩|逛|買|买|看|住)/.test(n) && /(地方|地点|地點|区域|區域)/.test(n)) {
    return true;
  }
  return isCategoryActivityLabel(raw);
}

/**
 * Category / activity vocabulary (zh / en / ja / ko) of the place-category flows: the
 * chat category query words (chat-place-category-types), the Roamie category → Places type map
 * (affiliate/place-type-category-map) and the category / exclusion families (博物館・夜市・動物園・
 * 溫泉・樂園 …). A label made only of these words (plus switch / filler wording) is a category,
 * never a destination; any other word left (「京都國立博物館」「澳洲博物館」"the Australian
 * Museum") keeps it a named place.
 */
const CATEGORY_ACTIVITY_CJK_TOKEN_RE =
  /博物館|博物馆|美術館|美术馆|藝廊|艺廊|展覽館|展覽|展館|咖啡廳|咖啡厅|咖啡店|咖啡館|咖啡馆|咖啡|餐廳|餐厅|美食|小吃|夜市|市集|市場|市场|商圈|商場|商场|百貨公司|百貨|百货|購物中心|購物|购物|逛街|買東西|买东西|老街|溫泉|温泉|泡湯|泡汤|動物園|动物园|水族館|水族馆|植物園|植物园|主題樂園|主题乐园|遊樂園|游乐园|樂園|乐园|公園|公园|海邊|海边|海灘|海滩|沙灘|沙滩|酒吧|夜景|景點|景点|寺廟|寺庙|神社|教堂|步道|爬山|登山|健行|買い物|ショッピング|カフェ|レストラン|遊園地|テーマパーク|ビーチ|お寺|海|박물관|미술관|온천|쇼핑|카페|맛집|식당|동물원|수족관|놀이공원|테마파크|야시장|시장|해변|바다|공원|술집/g;
const CATEGORY_ACTIVITY_EN_TOKEN_RE =
  /\b(?:museums?|art\s+galler(?:y|ies)|galler(?:y|ies)|caf[eé]s?|coffee(?:\s+shops?)?|restaurants?|food|shopping(?:\s+malls?)?|malls?|outlets?|night\s+markets?|markets?|onsens?|zoos?|aquariums?|botanical\s+gardens?|theme\s+parks?|amusement\s+parks?|parks?|beach(?:es)?|bars?|nightlife|temples?|shrines?|hiking)\b/gi;
/**
 * "hot springs" / "Hot springs" is the activity; "Hot Springs" (both words capitalized, e.g. the US
 * city) is a place name, so it stays out of the case-insensitive vocabulary above.
 */
const CATEGORY_ACTIVITY_HOT_SPRINGS_RE = /\b(?:hot|Hot|HOT)\s+springs?\b/g;
/** Switch / filler wording allowed around a category word (whole fragments only). */
const CATEGORY_ACTIVITY_FILLER_FRAGMENT_RE =
  /^(?:the|a|an|some|to|go|more|instead|of|switch|change|swap|let'?s|please|visit|see|then|and|or|maybe|how|about|it|make|[了吧啦呢的去玩看]|改去|改成去|改成|換成|换成|換去|换去|換到|换到|改到|改為|改为|走走|逛逛|看看|[にへでをはが]|に?変更|に?して|に?しよう|(?:으|)로|에|을|를|은|는|바꿔|하자|가자)+$/i;

/** Sentence-initial negated clause (zh / en / ja / ko): 「不去海邊了，」"instead of the beach," 「海じゃなくて」「바다 말고」. */
const CATEGORY_SWITCH_NEGATED_CLAUSE_RES: RegExp[] = [
  /^(?:我們|我们|那我|那就|我|那)?(?:不去|不要去|不想去|別去|别去|不要)[^，,、。]{1,24}?了?[，,、。\s]+/,
  /^[^\s，,、。]{1,24}?(?:就)?(?:不去|不要去|不想去|不要)了?[，,、。\s]+/,
  /^(?:not|no\s+more|skip|forget(?:\s+about)?|instead\s+of|rather\s+than)\s+[^,;.!]{1,40}?(?:\s+(?:anymore|any\s+more))?\s*[,;.!]\s*/i,
  /^[^\s、,，。]{1,24}?(?:は|を)?(?:やめて|じゃなくて|じゃなく|ではなくて|ではなく)[、,，。\s]*/,
  /^[^\s,，。]{1,24}?(?:은|는|을|를)?\s*(?:말고|대신에?|빼고)[,，\s]*/,
];

/** Sentence-initial wish wording (zh / en): 「我想去」「我要去」"I want to (go to)" "I'm going to". */
const CATEGORY_WISH_PREFIX_RE =
  /^(?:(?:我們|我们|那我|那就|我|那|就)?(?:還是|还是|比較|比较|只)?(?:想要|想|要)(?:去|到)?(?:泡(?=溫泉|温泉))?|(?:今天|明天|後天|后天|今晚|明晚)(?:我們|我们|我)?(?:想要|想|要)?(?:去|到)|(?:i|we)(?:['’]d|\s+would)?\s+(?:really\s+)?(?:want|wanna|like|love|hope)\s+(?:to\s+)?|(?:i['’]m|i\s+am|we['’]re|we\s+are)\s+going\s+(?:to\s+)?)/i;
/**
 * Sentence-final wish wording (ko / ja): 「에 가고 싶어」「温泉に行きたい」.
 */
const CATEGORY_WISH_SUFFIX_RE =
  /\s*(?:(?:에|으로|로)?\s*(?:가고\s*싶어(?:요)?|가고\s*싶다|갈래(?:요)?|가자|갈게(?:요)?)|(?:に|へ)(?:行きたい(?:です)?|行こう|行きます))[.!！。]?$/u;

/**
 * 「改去博物館」「不去海邊了，改去夜市」"switch to cafe" "instead of the beach, museums"
 * 「海じゃなくて温泉に変更」「바다 말고 박물관으로 바꿔」: when the wording after an optional
 * negated clause is only switch wording + category / activity words, the category words alone
 * (the text a category search reads its area from); otherwise undefined. Lexical only.
 */
export function categorySwitchSearchText(text: string): string | undefined {
  let body = (text ?? "").trim();
  if (!body) return undefined;
  for (const re of CATEGORY_SWITCH_NEGATED_CLAUSE_RES) {
    const m = body.match(re);
    if (m && body.length > m[0].length) {
      body = body.slice(m[0].length).trim();
      break;
    }
  }
  // 「我想去博物館」"I want to go to a museum"「美術館に行きたい」「박물관에 가고 싶어」: a wish wrapper
  // around category words only is the same category request (no named place is read from it).
  const wishBody = body
    .replace(CATEGORY_WISH_PREFIX_RE, "")
    .replace(CATEGORY_WISH_SUFFIX_RE, "")
    .trim();
  if (wishBody && wishBody !== body && isCategoryActivityLabel(wishBody)) body = wishBody;
  if (!isCategoryActivityLabel(body)) return undefined;
  const words = [
    ...(body.match(CATEGORY_ACTIVITY_EN_TOKEN_RE) ?? []),
    ...(body.match(CATEGORY_ACTIVITY_HOT_SPRINGS_RE) ?? []),
    ...body.replace(CATEGORY_ACTIVITY_EN_TOKEN_RE, " ").replace(CATEGORY_ACTIVITY_HOT_SPRINGS_RE, " ").match(CATEGORY_ACTIVITY_CJK_TOKEN_RE) ?? [],
  ];
  return words.length ? words.join(" ") : body;
}

/** True when the whole label is a category / activity (no named place left); see the vocabulary above. */
export function isCategoryActivityLabel(label: string): boolean {
  const raw = (label ?? "").trim();
  if (!raw || raw.length > 40) return false;
  if (mapPlaceLabelToGoogleType(raw)) return true;
  const replaced = raw
    .replace(CATEGORY_ACTIVITY_EN_TOKEN_RE, "\u0001")
    .replace(CATEGORY_ACTIVITY_HOT_SPRINGS_RE, "\u0001")
    .replace(CATEGORY_ACTIVITY_CJK_TOKEN_RE, "\u0001");
  if (!replaced.includes("\u0001")) return false;
  return replaced
    // eslint-disable-next-line no-control-regex -- \u0001 is the intentional token separator inserted above
    .split(/[\u0001\s,，、。.!！?？~～]+/u)
    .filter(Boolean)
    .every((fragment) => CATEGORY_ACTIVITY_FILLER_FRAGMENT_RE.test(fragment));
}

/** 通過驗證才回傳正規化目的地，否則 undefined */
export function coerceTravelDestination(name: string | undefined | null): string | undefined {
  if (!name?.trim()) return undefined;
  const label = normalizeDestinationLabel(name.trim());
  if (isCategoryNonDestinationLabel(label)) return undefined;
  if (!isValidParsedDestinationLabel(label)) return undefined;
  return label;
}

/** Switch / negation wording left inside a destination string (「雪梨了改去熱海」「京都にする」"switch to …"). */
const NON_PLACE_SWITCH_RESIDUE_RE =
  /改去|改成|換成|换成|換去|换去|換到|换到|改到|不要|不去|不想去|算了|以外|やめ|빼|말고|にする|に変更|へ変更|(?:으로|로)\s*바꿔|\b(?:instead|switch\s+to|change\s+to|except|not)\b/iu;
/** Exclusion wording on a place (「京都以外」「京都不要」「京都はやめて」「교토 말고」"except Kyoto" "not Kyoto"). */
const DESTINATION_EXCLUSION_RE =
  /以外(?!\s*に?も)|(?<=\p{Script=Han})不要[\s。！!.]*$|やめ|빼|말고|\bexcept\b|^\s*not\b|\banything\s+but\b/iu;
/** A trailing 了 particle after a Han name (「雪梨了」); 了 inside a name is never checked. */
const NON_PLACE_TRAILING_LE_RE = /(?<=\p{Script=Han})了$/u;
/** A leading time word (「今天」「這次」…); 明日香 stays a place. */
const NON_PLACE_TIME_LEAD_RE = /^(?:今天|明天|後天|后天|昨天|今晚|明晚|今日|明日(?!香)|這次|这次|這趟|这趟|下次|오늘|내일|today\b|tomorrow\b)/i;
/**
 * Sentence-final ja / ko travel-wish wording: 「東京へ行きたい」「北海道に行こう」「日本への旅行」
 * 「沖縄へ旅行に行きたい」「東京 へ旅行」「日本へ旅行中」「도쿄에 가고 싶어」.
 */
const TRAVEL_WISH_SUFFIX_RE =
  /\s*(?:(?:に|へ)\s*(?:行きたい(?:です)?|行きます|行こう|行く)|(?<=[\p{Script=Han}\p{Script=Katakana}]\s*)(?:への|に|へ)\s*(?:旅行|観光)(?:したい(?:です)?|します|中|\s*に\s*(?:行きたい(?:です)?|行きます|行こう|行く))?|(?:에|으로|로)\s*(?:가고\s*싶어(?:요)?|가고\s*싶다|갈래(?:요)?|가자|갈게(?:요)?))[.!！。]?$/u;
/** The same wording left inside a destination string is never a place name (「沖縄へ旅行」「日本へ旅行中」). */
const NON_PLACE_TRAVEL_WISH_RESIDUE_RE =
  /(?:に|へ)\s*(?:行きたい|行きます|行こう|行く)|(?:への|へ)\s*(?:旅行|観光)|가고\s*싶|갈래|갈게/u;

/**
 * 「東京へ行きたい」→「東京」「도쿄에 가고 싶어」→「도쿄」: drops sentence-final ja / ko travel-wish
 * wording so only the place is read (unchanged text otherwise).
 */
export function stripTravelWishSuffix(text: string): string {
  const t = (text ?? "").trim();
  const stripped = t.replace(TRAVEL_WISH_SUFFIX_RE, "").trim();
  return stripped || t;
}

/** Filler allowed around a bare city answer (「東京吧」「東京で」「도쿄요」). */
const CITY_ANSWER_FILLER_RE = /^(?:的|吧|啊|喔|哦|呀|好了|で|に|へ|かな|です|에서|에|요|으로|로|please)*$/iu;

/**
 * 「東京」「Tokyo」「도쿄」「東京吧」: the answer names only a city (no days, dates, category or
 * other request); its destination label, otherwise undefined. Lexical only (no geocode).
 */
export function cityOnlyAnswerDestination(text: string): string | undefined {
  const t = (text ?? "")
    .trim()
    .replace(/[\s。．.！!？?、,，~〜…]+$/u, "")
    .replace(/^(?:是|在)/u, "")
    .trim();
  if (!t || t.length > 40 || /\d/.test(t)) return undefined;
  if (hasCategoryPlaceQuery(t) || categorySwitchSearchText(t) || /[一二三四五六七八九十兩两]\s*天/.test(t)) return undefined;
  const dest = resolveDestinationFromText(t);
  if (dest) {
    const label = normalizeDestinationLabel(dest);
    for (const surface of [dest, label]) {
      if (surface && t.includes(surface)) {
        return CITY_ANSWER_FILLER_RE.test(t.replace(surface, "").trim()) ? label : undefined;
      }
    }
  }
  // An alias spelling (「Tokyo」「도쿄」「도쿄요」「Tokyo please」): a short name only, never a sentence.
  if (/^[\p{L}\s.'’-]+$/u.test(t) && t.split(/\s+/).length <= 3 && !isFutureTripPlanningStatement(t)) {
    const stripped = t.replace(/\s*(?:에서|에|요|으로|로|please)$/iu, "").trim();
    // The whole remainder is a known alias (「도쿄 여행」"Tokyo trip" stay the general flow).
    const aliasDest = applyCityLocaleAlias(stripped);
    if (!aliasDest || aliasDest === stripped || (dest && aliasDest !== dest)) return undefined;
    return normalizeDestinationLabel(aliasDest);
  }
  return undefined;
}

/** Question residue (「今天到底要去哪」→「底要去哪」「要吃什麼」): a question, never a place name. */
// A bare 「哪」 (the target of 「…要去哪」) is the question word itself.
const NON_PLACE_QUESTION_RESIDUE_RE = /去哪|哪裡|哪里|哪兒|哪儿|什麼|什么|甚麼|怎麼|怎么|(?<=\p{Script=Han})[哪嗎吗呢]$|^哪$/u;
/** "a cheaper hotel" "the other option": article + generic noun, never a place name. */
const NON_PLACE_EN_GENERIC_RE =
  /^(?:a|an|the|some|another|other|any)\s+(?:[a-z'-]+\s+){0,3}(?:hotels?|hostels?|restaurants?|places?|spots?|options?|plans?|ones?|cit(?:y|ies)|areas?|destinations?|rooms?|stays?|trips?)$/i;
/** en nearby residue ("eat nearby" "to eat nearby" "near me" "around here" "good to eat"): never a place name. */
// Food / drink words ("drink" "drinks" "food" "eat and drink" "I want to eat") are never a place name either.
const NON_PLACE_EN_NEARBY_RE = /^(?:(?:(?:i|we)(?:\s+(?:want|wanna|would\s+like)|['’]d\s+like)\s+)?(?:(?:any|some)thing\s+)?(?:good\s+)?(?:to\s+)?(?:eat|drinks?|food)(?:\s+(?:and|&)\s+(?:eat|drinks?|food))?(?:\s+(?:here|nearby|near\s+me|around\s+here))?|nearby|near\s+me|around\s+here)$/i;
/** A yes / no reply to the candidate confirmation (「はい」「いいえ」「うん」「아니요」"yes" "no") is never a place name. */
const NON_PLACE_YES_NO_RE =
  /^(?:はい|ええ|うん|ううん|いいえ|いや|そうです|네|예|응|아니요|아뇨|아니|yes|yeah|yep|no|nope|ok|okay|sure|是|是的|好|好的|對|对|不是|不要|沒有|没有|不對|不对|嗯)[\s.!?。！？]*$/iu;
/**
 * A wish to travel without any place, left after the travel word was read as a destination
 * (「したい」「の計画を立てたい」「プランを作って」「旅行」「여행 계획 세워줘」"travel" "plan a trip"
 * "go on a trip"). Whole-string anchored: 「東京旅行」"Tokyo trip" "trip to Tokyo" keep the place.
 */
const NON_PLACE_TRAVEL_WORD_RESIDUE_RES: RegExp[] = [
  /^(?:どこか|どっか)?(?:旅行|旅|観光|プラン|計画|予定|[のをにへが]|\s)*(?:したい(?:です)?|しよう|します|立てたい(?:です)?|立てて(?:ください)?|作って(?:ください)?|作りたい(?:です)?|行きたい(?:です)?|行こう|行く)?$/u,
  /^(?:我)?(?:想|要)?(?:去|出去)?(?:安排|規劃|规划)?(?:一趟|一次|個|个)?(?:旅行|旅遊|旅游|玩|走走|度假|渡假|行程)$/u,
  /^(?:我)?(?:想|要)?(?:去|出去)?(?:安排|規劃|规划)?(?:一趟|一次)$/u,
  /^(?:어디론가|어디든|어디)?\s*(?:여행|계획|일정|\s)*(?:을|를)?\s*(?:하고|가고|떠나고|세워|짜)?\s*(?:싶어(?:요)?|싶다|줘|주세요)?$/u,
  /^(?=.*\b(?:travel\w*|trips?|vacations?|holidays?|journeys?|getaways?|itinerar(?:y|ies)|plans?)\b|.*\b(?:go|take)\b.*\b(?:somewhere|anywhere|someplace)$)(?:(?:i|we)\s+(?:want|wanna|would\s+like|['’]d\s+like|need)\s+to\s+)?(?:(?:go|take|plan|make|book|have|travel)\s+)*(?:(?:on|for)\s+)?(?:(?:a|an|my|our|the|some)\s+)?(?:travel(?:l?ing)?|trips?|vacations?|holidays?|journeys?|getaways?|itinerar(?:y|ies)|plans?)?(?:\s*\b(?:(?:me|us)\s+)?(?:somewhere|anywhere|someplace))?(?:\s+for\s+(?:me|us))?$/i,
];
const isTravelWordResidue = (raw: string): boolean => NON_PLACE_TRAVEL_WORD_RESIDUE_RES.some((re) => re.test(raw));

/**
 * Final guard before a destination string is written into the session: switch / negation
 * residue, a leading time word, an en article + generic noun, or a category / activity
 * (isCategoryNonDestinationLabel) is never a destination. Locally known destinations pass.
 */
export function isNonPlaceDestinationText(name: string | undefined | null): boolean {
  const raw = (name ?? "").trim();
  if (!raw) return false;
  if (isKnownDestinationLabel(normalizeDestinationLabel(raw))) return false;
  return (
    NON_PLACE_SWITCH_RESIDUE_RE.test(raw) ||
    NON_PLACE_TRAILING_LE_RE.test(raw) ||
    NON_PLACE_TIME_LEAD_RE.test(raw) ||
    NON_PLACE_EN_GENERIC_RE.test(raw) ||
    NON_PLACE_EN_NEARBY_RE.test(raw) ||
    NON_PLACE_YES_NO_RE.test(raw) ||
    NON_PLACE_QUESTION_RESIDUE_RE.test(raw) ||
    NON_PLACE_TRAVEL_WISH_RESIDUE_RE.test(raw) ||
    isTravelWordResidue(raw) ||
    isCategoryNonDestinationLabel(raw)
  );
}

/** 提問語、代詞、動詞片語 — 不可當目的地 */
export function isValidParsedDestinationLabel(name: string): boolean {
  const n = name.trim();
  if (!safeDestinationCandidate(n) || isCalendarOnly(n)) return false;
  if (isCategoryNonDestinationLabel(n)) return false;
  if (isNonPlaceDestinationText(n)) return false;
  if (NON_DESTINATION_LABELS.has(n)) return false;
  if (/^(哪|什麼|什么|何人|何處|何处|附近|這|这|那|幾|何時|何时|怎麼|怎么|如何)/.test(n)) {
    return false;
  }
  if (/哪裡|哪里|什麼地方|什么地方|去哪|適合|适合|推薦|推荐/.test(n)) return false;
  if (/(?:下個月|下个月|下月|這個月|这个月|想去|想要|幫我|帮我|安排|規劃|规划|你可以|可以|幾天|天數|天数)/.test(n)) {
    return false;
  }
  if (splitKnownParentAreaLabel(n)) return true;
  return true;
}

function stripTrailingMotionVerb(name: string): string {
  return name.replace(/(?:走走|逛逛|玩玩|玩)$/, "").trim();
}

function acceptParsedDestination(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const normalized = normalizeDestinationLabel(stripTrailingMotionVerb(candidate));
  if (!isValidParsedDestinationLabel(normalized)) return undefined;
  return normalized;
}

function matchGenericLeadingDestination(text: string): string | undefined {
  const patterns = [
    /^([\u4e00-\u9fff]{2,8}?|[A-Za-z]{2,12})(?:的)?(?:(?:什麼|什么)時候|(?:何时|何時)|(?:幾|几)月|哪個月|哪个月|適合|适合|最好|比較好|比较好)(?:去|$)/,
    /^([\u4e00-\u9fff]{2,8}?|[A-Za-z]{2,12})(?:的)?(?:最佳|花季|雨季|旺季|淡季|極光|极光|雪季)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const candidate = normalizeDestinationLabel(m[1]);
    if (isValidParsedDestinationLabel(candidate)) return candidate;
  }
  return undefined;
}

/** 從長句中擷取已知目的地（如「明天要去台北有推薦景點嗎」→ 台北） */
const EMBEDDED_DESTINATION_LABELS = [
  "阿里山",
  "日月潭",
  "太魯閣",
  "清境",
  "墾丁",
  "九份",
  "玉山",
  "武陵",
  "合歡山",
  "溪頭",
  "杉林溪",
  "野柳",
  "十分",
  "平溪",
  "貓空",
  "陽明山",
  "象山",
  "龜山島",
  "蘭嶼",
  "綠島",
  "北投",
  "淡水",
  "礁溪",
  "知本",
  "池上",
  "高美濕地",
  "福壽山",
  "富士山",
  "河口湖",
  "箱根",
  "鎌倉",
  "輕井澤",
  "白川鄉",
  "芭達雅",
  "帕塔雅",
  "普吉島",
  "普吉",
  "蘇梅島",
  "蘇梅",
  "清邁",
  "河內",
  "胡志明",
  "峴港",
  "吉隆坡",
  "檳城",
  "峇里島",
  "宿霧",
  "長灘島",
  "札幌",
  "北海道",
  "沖繩",
  "廣島",
  "奈良",
  "神戶",
  "濟州島",
  "濟州",
  "台北",
  "臺北",
  "新北",
  "桃園",
  "台中",
  "臺中",
  "台南",
  "臺南",
  "高雄",
  "基隆",
  "新竹",
  "嘉義",
  "花蓮",
  "台東",
  "臺東",
  "宜蘭",
  "澎湖",
  "金門",
  "馬祖",
  "京都",
  "大阪",
  "東京",
  "橫濱",
  "横浜",
  "Yokohama",
  "名古屋",
  "福岡",
  "首爾",
  "釜山",
  "香港",
  "澳門",
  "新加坡",
  "曼谷",
  "巴黎",
  "倫敦",
  "紐約",
  "洛杉磯",
  "舊金山",
  "雪梨",
  "墨爾本",
  "泰國",
  "日本",
  "韓國",
  "越南",
  "蒙古",
].sort((a, b) => b.length - a.length);

/**
 * True when another listed label overlaps `label` and starts earlier in `text`.
 * 「日本東京都」contains 京都 inside 東京都; list order alone would resolve Tokyo as Kyoto.
 */
export function isShadowedEmbeddedLabel(
  text: string,
  label: string,
  labels: readonly string[],
): boolean {
  const index = text.indexOf(label);
  if (index < 0) return false;
  return labels.some((other) => {
    if (other === label) return false;
    const otherIndex = text.indexOf(other);
    return otherIndex >= 0 && otherIndex < index && otherIndex + other.length > index;
  });
}

export function extractEmbeddedDestinationFromText(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const afterTravel = t.match(
    /(?:我)?(?:明天|後天|后天|今天|今日|下週|下星期|下個月|下个月)?(?:要)?(?:想)?去([\u4e00-\u9fffA-Za-z]{2,10})(?=有|推薦|推荐|景點|景点|地點|地点|地方|嗎|吗|嘛|呢|吧|，|。|？|\?|！|!|\s|$)/,
  );
  if (afterTravel?.[1]) {
    const accepted = acceptParsedDestination(afterTravel[1]);
    if (accepted) return accepted;
  }

  for (const label of EMBEDDED_DESTINATION_LABELS) {
    if (!t.includes(label)) continue;
    if (isShadowedEmbeddedLabel(t, label, EMBEDDED_DESTINATION_LABELS)) continue;
    const accepted = acceptParsedDestination(label);
    if (accepted) return accepted;
  }

  return undefined;
}

/** 統一解析目的地：regex → 選擇句 → 長句嵌入 */
export function resolveDestinationFromText(text: string): string | undefined {
  return (
    parseDestinationFromText(text) ??
    parseDestinationSelectionFromText(text) ??
    extractEmbeddedDestinationFromText(text)
  );
}

/** 使用者回覆區域選擇（如「芭達雅」「我想去芭達雅」） */
export function parseDestinationSelectionFromText(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const fromWantGo = t.match(
    /(?:我)?(?:想)?去([\u4e00-\u9fffA-Za-z]{2,10})(?=[有推薦推荐景點景点地點地点地方嗎吗嘛呢吧啊呀，。\s]|$)/,
  );
  if (fromWantGo?.[1]) {
    const accepted = acceptParsedDestination(fromWantGo[1]);
    if (accepted) return accepted;
  }

  if (t.length <= 12 && !/(幾月|什麼時候|比較好|適合)/.test(t)) {
    const bare = acceptParsedDestination(normalizeDestinationLabel(t));
    if (bare && isKnownTouristCityLabel(bare)) return bare;
  }

  return undefined;
}

export function isMoodRecommendationSession(session: ChatPlanningSession): boolean {
  return Boolean(
    session.fromMoodFlow ||
      session.fromMoodCard ||
      session.homeMoodShortcutEntry ||
      session.conversationMode === "mood_recommend",
  );
}

export function parseDestinationFromText(text: string): string | undefined {
  try {
    const t = text.trim();
    if (!t) return undefined;
    // 「大阪不去了，換金澤」：被否定的舊城市不可當目的地，只解析切換後的語句。
    const negatedSwitch = parseNegatedDestinationSwitchTurn(t);
    if (negatedSwitch) return parseDestinationFromText(negatedSwitch.remainderText);
    // 「京都以外」「京都不要」「京都はやめて」「교토는 빼줘」"anything but Kyoto": an excluded place is never the destination.
    if (DESTINATION_EXCLUSION_RE.test(t)) return undefined;

    if (isCalendarOnly(t)) return undefined;
    const globalCandidates = travelDestinationCandidates(t);
    if (globalCandidates.length > 1) return undefined;
    if (globalCandidates.length === 1 && !isNonPlaceDestinationText(globalCandidates[0])) {
      return normalizeDestinationLabel(globalCandidates[0]);
    }
    const itineraryDest = extractItineraryDestinationFromText(t);
    if (itineraryDest) return itineraryDest;

    const leading = parseLeadingDestinationLabel(t);
    if (leading) return leading;

    const nextMonthGo = t.match(/(?:下個月|下个月|下月)(?:想|要)?去([\u4e00-\u9fff]{2,10})/);
    if (nextMonthGo?.[1]) {
      const accepted = acceptParsedDestination(nextMonthGo[1]);
      if (accepted) return accepted;
    }

    const thisMonthGo = t.match(/(?:這個月|这个月|本月)(?:想|要)?去([\u4e00-\u9fff]{2,10})/);
    if (thisMonthGo?.[1]) {
      const accepted = acceptParsedDestination(thisMonthGo[1]);
      if (accepted) return accepted;
    }

    const withDays = t.match(/我想?去([\u4e00-\u9fff]{2,8})(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天/);
    if (withDays?.[1]) return acceptParsedDestination(withDays[1]);

    const cityDays = t.match(
      /(?:^|(?<=[^去]))([\u4e00-\u9fff]{2,8})\s*(?:\d+|[一二三四五六七八九十百千兩两]+)\s*天/,
    );
    if (cityDays?.[1] && (KNOWN_CITIES.test(cityDays[1]) || isKnownCountryLabel(cityDays[1]))) {
      return acceptParsedDestination(cityDays[1]);
    }

    const monthDest = t.match(/(\d{1,2})\s*月\s*(?:想)?去([\u4e00-\u9fff]{2,10})/);
    if (monthDest?.[2]) return acceptParsedDestination(monthDest[2]);

    const destMonth = t.match(/([\u4e00-\u9fff]{2,10})(\d{1,2})\s*月/);
    if (destMonth?.[1]) return acceptParsedDestination(destMonth[1]);

    const destMonthGo = t.match(/(?:想)?去([\u4e00-\u9fff]{2,10})\s*(\d{1,2})\s*月/);
    if (destMonthGo?.[1]) return acceptParsedDestination(destMonthGo[1]);

    const wantGo = t.match(/(?:我)?(?:想)?去([\u4e00-\u9fffA-Za-z]{2,10})(?:[啊呀呢吧]|$|，|。)/);
    if (wantGo?.[1]) {
      const accepted = acceptParsedDestination(wantGo[1]);
      if (accepted) return accepted;
    }

    const patterns = [
      /(?:我想?去|要去|想去|幫我規劃|規劃|安排)([\u4e00-\u9fffA-Za-z]{2,10})(?:走走|逛逛|玩|旅行|旅遊|有|推薦|推荐|景點|景点|地點|地点|，|。|嗎|吗|？|\?|$)/,
      /去([\u4e00-\u9fffA-Za-z]{2,10})(?:走走|逛逛|玩|有|推薦|推荐|景點|景点|，|。|嗎|吗|？|\?|$)/,
    ];

    for (const re of patterns) {
      const m = t.match(re);
      const city = m?.[1];
      if (!city) continue;
      const accepted = acceptParsedDestination(city);
      if (accepted) return accepted;
      if (isKnownScenicLabel(normalizeDestinationLabel(city))) {
        return normalizeDestinationLabel(city);
      }
    }

    const knownCityActivity = matchKnownCityActivityPhrase(t);
    if (knownCityActivity) return knownCityActivity;

    const selection = parseDestinationSelectionFromText(t);
    if (selection) return selection;

    const bare = t.match(KNOWN_CITIES);
    if (bare) return acceptParsedDestination(`${bare[1]}${bare[2] ?? ""}`);

    const touristBare = t.match(KNOWN_TOURIST_CITIES);
    if (touristBare) return acceptParsedDestination(touristBare[1]);

    const scenicBare = t.match(KNOWN_SCENIC_SPOTS);
    if (scenicBare) return acceptParsedDestination(scenicBare[1]);

    const countryBare = t.match(KNOWN_COUNTRIES);
    if (countryBare) return acceptParsedDestination(countryBare[1]);

    const embedded = extractEmbeddedDestinationFromText(t);
    if (embedded) return embedded;

    const alias = extractKnownAliasDestination(t);
    if (alias) {
      const accepted = acceptParsedDestination(alias.canonical);
      if (accepted) return accepted;
    }

    // 「12월에 일본 여행」"go Sydney please": a leading month (read by the month parser) or a trailing
    // "please" around the same short alias form.
    const aliasBody = t
      .replace(/^\d{1,2}\s*월\s*(?:에)?\s+/u, "")
      .replace(/[\s,，]+please[.!！]*$/iu, "")
      .trim();
    if (aliasBody && aliasBody !== t) {
      const bodyAlias = extractKnownAliasDestination(aliasBody);
      if (bodyAlias) {
        const accepted = acceptParsedDestination(bodyAlias.canonical);
        if (accepted) return accepted;
      }
    }

    return undefined;
  } catch (e) {
    console.warn("[trip-planning] parseDestinationFromText failed", e);
    return undefined;
  }
}

export function isNearbyExploreText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (parseDestinationFromText(t) && !/(附近|這一帶|現在|今天)/.test(t)) return false;
  return /(附近|這一帶|現在|今天|當下|離我|我這邊|我附近)/.test(t);
}

export type DestinationSwitchTurn = {
  state: "CONFIRMED_SWITCH" | "NEGATED_UNCERTAIN" | "NO_SWITCH";
  authority?: "local" | "pending_provider";
  reason?: "no_negated_place" | "target_not_place" | "same_place";
  form?: "legacy" | "extended" | "negated_only";
  hasNegatedClause: boolean;
  negatedText?: string;
  /** The only string that may be sent to the Destination Authority. */
  targetLabel?: string;
  remainderText?: string;
  switchedText?: string;
  /** Whole sentence without the negated clause and the target wording (activity tail incl.). */
  requestText: string;
};

const SWITCH_SEPARATOR_RE = /[\s，,、]/;
const SWITCH_PUNCT_TRIM_RE = /^[\s，,、]+|[\s，,、]+$/g;
const SWITCH_ADMIN_TAIL_RE = /^\p{Script=Han}{1,5}(?:區|区|市|町|村|鄉|乡|鎮|镇|縣|县|郡)$/u;
const SWITCH_LABEL_MAX = 12;
const SWITCH_LABEL_FRAGMENT_RE = /(?:了|再|吧|嗎|呢|一點|一下)/;
/** 「我要」「我想」「那我要」 right before 去 after a negated-only clause (「雪梨不去了，我要去京都」). */
const NEGATED_ONLY_WISH_LEAD_RE = /^[\s，,、]*(?:我們|我们|那我|那就|我|那)?(?:要|想|會|会|打算)(?=去[^\s，,、])/;
const SWITCH_VENUE_SUFFIX_RE = /[廳厅店]$/;
/**
 * Generic alternative wording as a whole candidate (anchored; never a substring match):
 * optional determiner (一／另一／下一／別／其他…) + optional classifier (個／家／間) +
 * optional generic noun (地方／地點／城市／的), at least one part present
 * (「地方」「一個城市」「別家」「另一家」「下一個」), or the fixed 「新的」 wording
 * (「新的」「新的一家」「新的一個」, optionally after 「換」). 「新」 is no free determiner:
 * 「新城市」「新店」「那霸」 never match.
 */
const SWITCH_GENERIC_DETERMINER = "(?:另一|下一|一|另|別|别|其他|其它)";
const SWITCH_GENERIC_CLASSIFIER = "(?:個|个|家|間|间)";
const SWITCH_GENERIC_NOUN = "(?:地方|地點|地点|城市|的)";
const SWITCH_GENERIC_NEW_ONE = "(?:[換换]?新的(?:一家|一個|一个)?)";
const SWITCH_GENERIC_PLACE_WORD_RE = new RegExp(
  `^(?:${SWITCH_GENERIC_DETERMINER}?${SWITCH_GENERIC_CLASSIFIER}?${SWITCH_GENERIC_NOUN}|` +
    `${SWITCH_GENERIC_DETERMINER}?${SWITCH_GENERIC_CLASSIFIER}|${SWITCH_GENERIC_DETERMINER}|` +
    `${SWITCH_GENERIC_NEW_ONE})$`,
);

/** Label without a trailing activity tail when one splits off cleanly; otherwise as written. */
function withoutActivityTail(label: string): string {
  const split = splitTrailingActivityTail(label);
  return split.kind === "split" ? split.head : label;
}

/**
 * Existing local place Authority (known city / destination / known parent + admin tail).
 * Always checked before isPlaceShapedSwitchTarget, so a suffix exclusion never overrides it.
 */
function isLocalSwitchTarget(label: string): boolean {
  if (isKnownTouristCityLabel(label) || isKnownDestinationLabel(label)) return true;
  const split = splitKnownParentAreaLabel(label);
  return Boolean(split && SWITCH_ADMIN_TAIL_RE.test(split.area));
}

/**
 * Non-local wording that may name a place (pending provider). Only for labels the local
 * Authority did not resolve: venue-suffix (廳／店) labels are unprovable here and stay
 * NEGATED_UNCERTAIN (no paid lookup). Generic alternative wording (「一家」「別的」「其他的」
 * via the shared continuation grammar; existing non-area substrings; 「…的地方」 (exclusion
 * only); the anchored generic wording 「一個地方」「換城市」「別家」「新的」) is never one.
 */
function isPlaceShapedSwitchTarget(label: string): boolean {
  return (
    !SWITCH_GENERIC_PLACE_WORD_RE.test(label) &&
    label.length >= 2 &&
    label.length <= SWITCH_LABEL_MAX &&
    STRUCTURED_AREA_TAIL_RE.test(label) &&
    !hasCategoryPlaceQuery(label) &&
    !SWITCH_VENUE_SUFFIX_RE.test(label) &&
    !SWITCH_LABEL_FRAGMENT_RE.test(label) &&
    !isContinuationGrammarOnly(label) &&
    !INVALID_STRUCTURED_AREA_SUBSTRING.test(label) &&
    !isCategoryNonDestinationLabel(label) &&
    !isNonPlaceDestinationText(label)
  );
}

/**
 * 「雪梨不去了，我要去京都」→「雪梨不去了，去京都」: a negated-only clause on a known destination
 * followed by wish wording before 去 (「我要」「我想」), rewritten to the extended clause form, only
 * when that form is a local CONFIRMED_SWITCH; undefined otherwise. Lexical only.
 */
function negatedOnlyWishSwitchText(text: string): string | undefined {
  const raw = (text ?? "").trim();
  const clause = matchLeadingNegatedClause(raw);
  if (clause?.form !== "negated_only") return undefined;
  const negatedPlace = withoutActivityTail(clause.negatedText);
  if (!negatedPlace || !(isKnownTouristCityLabel(negatedPlace) || isKnownCountryLabel(negatedPlace))) return undefined;
  const rest = raw.slice(clause.length);
  const wish = rest.match(NEGATED_ONLY_WISH_LEAD_RE);
  if (!wish) return undefined;
  const rewritten = raw.slice(0, clause.length) + rest.slice(wish[0].length);
  const again = classifyDestinationSwitchTurn(rewritten);
  // Only a locally known target (「京都」) switches; any other wording (「熱海」「衝浪」) stays NEGATED_UNCERTAIN.
  return again.state === "CONFIRMED_SWITCH" && again.authority === "local" ? rewritten : undefined;
}

/** Explicit switch lead right after a dropped place (「換成」「改去」…; never a bare 「去」). */
const NEGATED_DROP_SWITCH_LEAD =
  "(?:換成去|换成去|改成去|換去|换去|改去|換成|换成|改成|換到|换到|改到|換|换|改)";
/** 「雪梨不要了，換成熱海」「雪梨算了，改去熱海」: dropped place first. */
const NEGATED_DROP_PLACE_FIRST_RE = new RegExp(
  `^([^\\s，,、換换改去了]{1,24}?)(?:就)?(?:不要了|算了)[\\s，,、]*(?=${NEGATED_DROP_SWITCH_LEAD}[^\\s，,、])`,
);
/** 「不要雪梨了，換成熱海」「我不要雪梨了，改去熱海」: dropped place after 不要. */
const NEGATED_DROP_PLACE_AFTER_RE = new RegExp(
  `^(?:我們|我们|那我|那就|我|那|就|還是|还是|先)?不要([^\\s，,、換换改去了]{1,24}?)了[\\s，,、]*(?=${NEGATED_DROP_SWITCH_LEAD}[^\\s，,、])`,
);
/**
 * 「雪梨不要了，換成熱海」「不要雪梨了，換成熱海」「我不要雪梨了，改去熱海」「雪梨算了，改去熱海」→
 * 「雪梨不去了，換成熱海」/「不去雪梨了，改去熱海」: a dropped place plus explicit switch wording, rewritten
 * to the negated clause form only when that form is a CONFIRMED_SWITCH; undefined otherwise. Lexical only.
 */
function negatedDropSwitchText(text: string): string | undefined {
  const raw = (text ?? "").trim();
  const first = raw.match(NEGATED_DROP_PLACE_FIRST_RE);
  const after = first ? null : raw.match(NEGATED_DROP_PLACE_AFTER_RE);
  const m = first ?? after;
  const place = m?.[1]?.trim();
  if (!m || !place) return undefined;
  const rest = raw.slice(m[0].length);
  const rewritten = first ? `${place}不去了，${rest}` : `不去${place}了，${rest}`;
  return classifyDestinationSwitchTurn(rewritten).state === "CONFIRMED_SWITCH" ? rewritten : undefined;
}

/**
 * parseNegatedDestinationSwitch, plus 「雪梨不去了，我要去京都」 read as 「雪梨不去了，去京都」
 * (negatedOnlyWishSwitchText) and 「雪梨不要了，換成熱海」 read as 「雪梨不去了，換成熱海」
 * (negatedDropSwitchText); every other text exactly as parseNegatedDestinationSwitch.
 */
export function parseNegatedDestinationSwitchTurn(text: string): ReturnType<typeof parseNegatedDestinationSwitch> {
  const direct = parseNegatedDestinationSwitch(text);
  if (direct) return direct;
  const rewritten = negatedOnlyWishSwitchText(text) ?? (matchLeadingNegatedClause((text ?? "").trim()) ? undefined : negatedDropSwitchText(text));
  return rewritten ? parseNegatedDestinationSwitch(rewritten) : null;
}

/**
 * Per-turn destination switch state (pure, lexical; no Session, no provider):
 * CONFIRMED_SWITCH (local / pending_provider), NEGATED_UNCERTAIN or NO_SWITCH.
 */
export function classifyDestinationSwitchTurn(text: string): DestinationSwitchTurn {
  const raw = (text ?? "").trim();
  const clause = matchLeadingNegatedClause(raw);
  if (!clause) {
    // 「雪梨不要了，換成熱海」: the same confirmed switch as 「雪梨不去了，換成熱海」.
    const dropped = negatedDropSwitchText(raw);
    return dropped
      ? classifyDestinationSwitchTurn(dropped)
      : { state: "NO_SWITCH", hasNegatedClause: false, requestText: raw };
  }

  const negatedText = clause.negatedText;
  const negatedPlace = withoutActivityTail(negatedText);
  // Full lead for legacy too (「換到京都」「換去京都」→「京都」); parse keeps the legacy strip.
  const { remainderText, afterLeadText, switchedText } = negatedClauseSwitchedText(raw, clause, {
    fullLead: true,
  });
  const base = {
    hasNegatedClause: true,
    form: clause.form,
    negatedText,
    remainderText,
  } as const;
  const clauseRequestText = remainderText.replace(SWITCH_PUNCT_TRIM_RE, "");

  if (clause.form === "negated_only") {
    // Narrow level check: only a known city / country is a negated destination.
    const isDestination =
      Boolean(negatedPlace) &&
      (isKnownTouristCityLabel(negatedPlace) || isKnownCountryLabel(negatedPlace));
    // 「雪梨不去了，我要去京都」: a wish wording before 去 is the same switch as
    // 「雪梨不去了，去京都」 (extended clause); classified on that form.
    const rewritten = negatedOnlyWishSwitchText(raw);
    if (rewritten) return classifyDestinationSwitchTurn(rewritten);
    return isDestination
      ? {
          ...base,
          state: "NEGATED_UNCERTAIN",
          reason: "target_not_place",
          requestText: clauseRequestText,
        }
      : { ...base, state: "NO_SWITCH", requestText: clauseRequestText };
  }

  const negatedIsPlace =
    Boolean(negatedPlace) &&
    (isKnownDestinationLabel(negatedPlace) || splitKnownParentAreaLabel(negatedPlace) !== null);

  if (clause.idiom) {
    return negatedIsPlace
      ? {
          ...base,
          switchedText,
          state: "NEGATED_UNCERTAIN",
          reason: "target_not_place",
          requestText: clauseRequestText,
        }
      : { ...base, switchedText, state: "NO_SWITCH", requestText: clauseRequestText };
  }

  const yHead = switchedText.split(SWITCH_SEPARATOR_RE)[0]?.trim() ?? "";
  const ySplit = splitTrailingActivityTail(yHead);
  const yLabel =
    ySplit.kind === "split"
      ? ySplit.head
      : ySplit.kind === "none"
        ? yHead
        : "";
  const target = yLabel ? normalizeDestinationAndDuration(yLabel).destinationLabel.trim() : "";
  const isLocal = Boolean(target) && isLocalSwitchTarget(target);
  const isPlaceShaped = Boolean(target) && !isLocal && isPlaceShapedSwitchTarget(target);
  const afterTarget =
    yHead && afterLeadText.startsWith(yHead) ? afterLeadText.slice(yHead.length) : afterLeadText;
  const requestText = afterTarget.replace(SWITCH_PUNCT_TRIM_RE, "");
  const withSwitch = { ...base, switchedText };

  if (!negatedText || LEADING_PRONOUN_ONLY_RE.test(negatedText)) {
    return isLocal || isPlaceShaped
      ? {
          ...withSwitch,
          state: "NEGATED_UNCERTAIN",
          reason: "no_negated_place",
          targetLabel: target,
          requestText,
        }
      : {
          ...withSwitch,
          state: "NEGATED_UNCERTAIN",
          reason: "target_not_place",
          requestText: clauseRequestText,
        };
  }
  if (!negatedIsPlace) return { ...withSwitch, state: "NO_SWITCH", requestText: clauseRequestText };
  if (isLocal) {
    if (normalizeDestinationLabel(target) === normalizeDestinationLabel(negatedPlace)) {
      return {
        ...withSwitch,
        state: "NEGATED_UNCERTAIN",
        reason: "same_place",
        requestText: clauseRequestText,
      };
    }
    return {
      ...withSwitch,
      state: "CONFIRMED_SWITCH",
      authority: "local",
      targetLabel: target,
      requestText,
    };
  }
  if (isPlaceShaped) {
    return {
      ...withSwitch,
      state: "CONFIRMED_SWITCH",
      authority: "pending_provider",
      targetLabel: target,
      requestText,
    };
  }
  return {
    ...withSwitch,
    state: "NEGATED_UNCERTAIN",
    reason: "target_not_place",
    requestText: clauseRequestText,
  };
}

export function isDestinationPlanningText(text: string, session: ChatPlanningSession): boolean {
  const t = text.trim();
  if (!t) return false;
  // Explicit place-category recommendation is never trip planning
  if (hasCategoryPlaceQuery(t) && !isComboItineraryQuery(t)) return false;
  // 「我想去公園」"I want to go to the beach": a category wish names no trip destination.
  if (categorySwitchSearchText(t)) return false;
  if (isDestinationAdviceText(t)) return true;
  if (isTravelPlanningText(t)) return true;
  if (/(我想?去|要去|想去|幫我規劃|規劃.*行程|安排.*行程)/.test(t) && parseDestinationFromText(t)) {
    return true;
  }
  if (/\d+\s*天/.test(t) && parseDestinationFromText(t)) return true;
  if (
    /(?:下個月|下个月|這個月|这个月|\d+\s*月)/.test(t) &&
    (parseDestinationFromText(t) || session.travelContext?.destination)
  ) {
    return true;
  }
  if (/(走走|逛逛|玩)/.test(t) && parseDestinationFromText(t) && !isNearbyExploreText(t)) {
    return true;
  }
  if (/(幾號|几号|哪一天|花季|什麼時候|什么时候)/.test(t) && parseDestinationFromText(t)) {
    return true;
  }
  return false;
}

export function isUserAtDestination(
  session: ChatPlanningSession,
  destination?: string,
): boolean {
  if (!destination?.trim()) return false;
  const current =
    session.location?.city ??
    session.travelContext?.currentLocation ??
    session.travelContext?.destination;
  if (!current?.trim()) return false;
  return normalizeCityLabel(current) === normalizeCityLabel(destination);
}

function isExplicitNearbyCategoryText(text: string): boolean {
  const t = text.trim();
  if (!t || isTravelPlanningText(t) || isDestinationAdviceText(t)) return false;
  if (isNearbyExploreText(t)) return true;
  if (
    /(餐廳|咖啡廳|咖啡店|咖啡|cafe|露營|景點)/i.test(t) &&
    /(附近|推薦|推荐|找|有沒有|有没有)/.test(t)
  ) {
    return true;
  }
  return false;
}

export function resolveConversationMode(
  text: string,
  session: ChatPlanningSession,
): ChatConversationMode {
  if (isTripAddPlaceSession(session)) {
    return "trip_add_place";
  }
  if (session.homeMoodShortcutEntry && !session.homeMoodShortcutEngaged) {
    if (isDestinationPlanningText(text, session) || isDestinationAdviceText(text)) {
      return "destination_planning";
    }
    return "mood_recommend";
  }
  if (session.fromMoodFlow || session.fromMoodCard) {
    if (isDestinationPlanningText(text, session) || isDestinationAdviceText(text)) {
      return "destination_planning";
    }
    return "mood_recommend";
  }
  if (
    session.placeDetailFocus ||
    session.selectedPlaceFromMood ||
    (session.phase === "followup" && session.selectedPlaces.length > 0 && !isDestinationPlanningText(text, session))
  ) {
    return "place_focus";
  }

  // Place recommendation (destination + category) must beat sticky destination_planning
  if (
    isExplicitNearbyCategoryText(text) ||
    (hasCategoryPlaceQuery(text) && !isComboItineraryQuery(text))
  ) {
    return "nearby_explore";
  }

  const persisted = session.tripPlanningContext?.intent;
  if (
    (persisted === "destination_planning" || isDestinationAdviceActive(session)) &&
    !isNearbyExploreText(text)
  ) {
    return "destination_planning";
  }
  if (persisted === "nearby_explore" && isNearbyExploreText(text)) {
    return "nearby_explore";
  }

  const dest =
    parseDestinationFromText(text) ??
    session.travelContext?.destination ??
    session.preferredArea;

  if (isNearbyExploreText(text) || (dest && isUserAtDestination(session, dest) && /(走走|逛逛)/.test(text))) {
    return "nearby_explore";
  }

  if (isDestinationPlanningText(text, session) || session.conversationMode === "destination_planning") {
    return "destination_planning";
  }

  return persisted ?? session.conversationMode ?? "general";
}

/** Text-only destinations remain in planning context, never pretend to have geometry. */
export function tripLocationFromCity(_city: string): undefined {
  return undefined;
}

export function mergeTripPlanningContext(
  text: string,
  session: ChatPlanningSession,
  travelCtx: CanonicalTravelContext,
): { context: TripPlanningContext; session: ChatPlanningSession } {
  try {
    if (isTripAddPlaceSession(session)) {
      const ctx = session.tripAddPlaceContext!;
      const prev = session.tripPlanningContext ?? EMPTY_TRIP_PLANNING_CONTEXT;
      const reinforced = reinforceTripAddPlaceSession(session, text);
      const context: TripPlanningContext = {
        ...prev,
        destination: ctx.destination,
        days: ctx.tripDates.dayCount ?? prev.days,
        intent: "trip_add_place",
      };
      return { context, session: reinforced };
    }

    const mode = resolveConversationMode(text, session);
    const prev = session.tripPlanningContext ?? EMPTY_TRIP_PLANNING_CONTEXT;
    const skipDestParse =
      (mode === "mood_recommend" || isMoodRecommendationSession(session)) &&
      !hasCategoryPlaceQuery(text) &&
      !isDestinationPlanningText(text, session) &&
      !isDestinationAdviceText(text);
    const parsedDestText = skipDestParse ? undefined : parseDestinationFromText(text);
    // 「改去Atami」「我要去海雲台」 just confirmed by geocode as 熱海市 / 海雲臺區: the typed surface is
    // that same geocoded destination, so the confirmed label (and its tripDestination) is kept.
    const resolvedRaw = travelCtx.destinationCandidate?.status === "resolved" ? travelCtx.destinationCandidate.raw : undefined;
    const surfaceOf = (v: string) => normalizeDestinationLabel(v).toLowerCase();
    // 「熱海, 日本」: the country named next to the confirmed city is not a destination of its own.
    const isCountryOfDestination = (v: string) =>
      Boolean(travelCtx.destinationCountry) &&
      isKnownCountryLabel(v) &&
      !isKnownTouristCityLabel(v) &&
      normalizeDestinationLabel(v) === normalizeDestinationLabel(travelCtx.destinationCountry!);
    const geocodedSurface = Boolean(
      parsedDestText && resolvedRaw && travelCtx.destination?.trim() &&
        (surfaceOf(parsedDestText) === surfaceOf(resolvedRaw) ||
          surfaceOf(resolvedRaw).includes(surfaceOf(parsedDestText)) ||
          surfaceOf(parsedDestText).includes(surfaceOf(resolvedRaw)) ||
          (text.includes(resolvedRaw) && isCountryOfDestination(parsedDestText))),
    );
    // The sentence names the old destination next to the candidate just geocoded into the trip
    // (tripDestination already that new place): the old name never writes back over it.
    const sameLabel = (a: string | undefined, b: string | undefined) =>
      Boolean(a?.trim() && b?.trim()) && normalizeDestinationLabel(a!) === normalizeDestinationLabel(b!);
    const oldNamedBesideResolved = Boolean(
      parsedDestText && resolvedRaw && text.includes(resolvedRaw) &&
        sameLabel(parsedDestText, prev.destination) &&
        travelCtx.destination?.trim() && !sameLabel(travelCtx.destination, prev.destination) &&
        (sameLabel(session.tripDestination?.city, travelCtx.destination) ||
          sameLabel(session.tripDestination?.displayLabel, travelCtx.destination)),
    );
    const parsedDest = geocodedSurface || oldNamedBesideResolved ? travelCtx.destination : parsedDestText;

    const destination =
      parsedDest ??
      (skipDestParse ? undefined : travelCtx.destination) ??
      prev.destination ??
      session.tripDestination?.city ??
      (skipDestParse ? undefined : session.preferredArea);

    const prevDestNorm = prev.destination
      ? normalizeDestinationLabel(prev.destination)
      : session.tripDestination?.city
        ? normalizeDestinationLabel(session.tripDestination.city)
        : undefined;
    const nextDestNorm = destination ? normalizeDestinationLabel(destination) : undefined;
    const destinationSwitched = Boolean(
      prevDestNorm && nextDestNorm && prevDestNorm !== nextDestNorm,
    );

    const days = destinationSwitched
      ? travelCtx.days
      : travelCtx.days ??
        session.tripDays ??
        prev.days ??
        (travelCtx.startDate && travelCtx.endDate
          ? enrichTripDatesInContext("", travelCtx, session).days
          : undefined);
    const travelMonth = destinationSwitched
      ? travelCtx.travelMonth
      : travelCtx.travelMonth ?? prev.travelMonth;
    const travelStyle =
      travelCtx.travelStyle ??
      travelCtx.vibe ??
      session.discovery?.vibe ??
      prev.travelStyle;

    const context: TripPlanningContext = {
      destination,
      origin: session.tripOrigin?.displayLabel ?? session.tripOrigin?.city ?? prev.origin,
      startDate: destinationSwitched
        ? travelCtx.startDate
        : travelCtx.startDate ?? session.tripStartDate ?? prev.startDate,
      endDate: destinationSwitched
        ? travelCtx.endDate
        : travelCtx.endDate ?? session.tripEndDate ?? prev.endDate,
      days,
      budget: travelCtx.budgetLevel ?? session.budget ?? prev.budget,
      travelStyle,
      transportation: travelCtx.transportMode ?? session.transportation ?? prev.transportation,
      peopleCount: prev.peopleCount,
      travelMonth,
      selectedPlaces: session.selectedPlaces.map((p) => p.name),
      intent: mode,
    };

    let nextSession: ChatPlanningSession = {
      ...session,
      tripPlanningContext: context,
      conversationMode: mode,
      preferredArea: destination ?? session.preferredArea,
    };

    if (destination && mode === "destination_planning") {
      const existingCity = session.tripDestination?.city?.trim();
      // A geocoded 海雲臺區 is the same place as the typed 海雲台 (script variant + district
      // suffix): the resolved trip destination is kept, never replaced by a label-only stub.
      // When both sides have a center, they must also agree (中山區 in 台北 ≠ 中山 in 廣東).
      const trip = session.tripDestination;
      const coords = travelCtx.destinationCoordinates;
      const centersAgree =
        !trip ||
        !coords ||
        !Number.isFinite(trip.lat) ||
        !Number.isFinite(trip.lng) ||
        (trip.lat === 0 && trip.lng === 0) ||
        !Number.isFinite(coords.lat) ||
        !Number.isFinite(coords.lng) ||
        (Math.abs(trip.lat - coords.lat) <= 0.05 && Math.abs(trip.lng - coords.lng) <= 0.05);
      const shouldReplaceTripDestination =
        !existingCity ||
        (normalizeDestinationLabel(existingCity) !== normalizeDestinationLabel(destination) &&
          !(sameHanPlaceVariant(existingCity, destination) && centersAgree));
      if (shouldReplaceTripDestination) {
        nextSession = {
          ...nextSession,
          tripDestination: tripLocationFromCity(destination),
        };
      }
    }

    if (mode === "destination_planning") {
      nextSession = {
        ...nextSession,
        activeChatIntent: undefined,
        phase: nextSession.phase === "discover" ? "recommend" : nextSession.phase,
      };
    }

    return { context, session: nextSession };
  } catch (e) {
    console.warn("[trip-planning] mergeTripPlanningContext failed", e);
    return {
      context: session.tripPlanningContext ?? EMPTY_TRIP_PLANNING_CONTEXT,
      session,
    };
  }
}

export function hasRemoteDestination(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): boolean {
  const dest =
    ctx.destination ??
    session.tripPlanningContext?.destination ??
    session.preferredArea ??
    session.tripDestination?.city;
  if (!dest?.trim()) return false;
  return !isUserAtDestination(session, dest);
}

export function missingDestinationPlanningKeys(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): TripIntentMissingKey[] {
  const planning = session.tripPlanningContext;
  const dest =
    ctx.destination ?? planning?.destination ?? session.tripDestination?.city;
  const missing: TripIntentMissingKey[] = [];

  if (!dest?.trim()) missing.push("destination");

  const hasStyle = Boolean(
    ctx.vibe?.trim() ||
      ctx.travelStyle?.trim() ||
      planning?.travelStyle?.trim() ||
      session.discovery?.vibe?.trim(),
  );
  if (dest && !hasStyle) missing.push("vibe");

  return missing;
}

export function buildDestinationPlanningClarify(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  key: TripIntentMissingKey,
  locale: Locale = "zh-TW",
): string {
  const dest = ctx.destination ?? session.tripPlanningContext?.destination ?? "這趟";
  const days = ctx.days ?? session.tripDays ?? session.tripPlanningContext?.days;
  const daysLabel = days ? ` ${days} 天` : "";
  const month = ctx.travelMonth ?? session.tripPlanningContext?.travelMonth;

  if (locale !== "zh-TW") {
    return key === "vibe"
      ? buildDestinationStyleChoiceQuestion(dest, { days, month, locale })
      : chatRuntimeCopy(`clarify_${key}`, locale);
  }

  switch (key) {
    case "destination":
      return "你想去哪個城市或地區呢？跟我說目的地，我幫你往下規劃。";
    case "vibe":
      return buildDestinationStyleChoiceQuestion(dest, { days, month });
    case "date":
      if (days && !ctx.startDate && !month) {
        return `好的，${dest}${daysLabel}。大概什麼時候出發呢？有月份或日期都可以跟我說。`;
      }
      return `大概什麼時候出發呢？有月份或具體日期都可以。`;
    case "companionship":
      return "這次是獨自、情侶、朋友還是家人一起呢？";
    case "setting":
      return "比較想室內慢慢逛，還是戶外走走？";
    default:
      return `跟我多說一點${dest}這趟想怎麼玩吧。`;
  }
}

export function formatTripPlanningContextForAi(ctx: TripPlanningContext): string {
  const lines = ["【Trip Planning Context】", `mode: ${ctx.intent}`];
  if (ctx.destination) lines.push(`destination: ${ctx.destination}`);
  if (ctx.origin) lines.push(`origin: ${ctx.origin}`);
  if (ctx.startDate) lines.push(`startDate: ${ctx.startDate}`);
  if (ctx.endDate) lines.push(`endDate: ${ctx.endDate}`);
  if (ctx.days) lines.push(`days: ${ctx.days}`);
  if (ctx.travelMonth) lines.push(`travelMonth: ${ctx.travelMonth}`);
  if (ctx.budget) lines.push(`budget: ${ctx.budget}`);
  if (ctx.travelStyle) lines.push(`travelStyle: ${ctx.travelStyle}`);
  if (ctx.transportation) lines.push(`transportation: ${ctx.transportation}`);
  if (ctx.peopleCount) lines.push(`peopleCount: ${ctx.peopleCount}`);
  if (ctx.selectedPlaces.length) lines.push(`selectedPlaces: ${ctx.selectedPlaces.join("、")}`);
  return lines.join("\n");
}
