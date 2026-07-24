import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  buildDailyRhythmReply,
  buildMustVisitPlacesReply,
  parsePlanningFollowUpIntent,
  resolveMustVisitAdvice,
} from "@/lib/ai/must-visit-places";
import {
  buildItineraryPlanningReply,
  buildDailyRecommendationsReply,
  itineraryGenerationStatusReply,
  parseItineraryPlanModeIntent,
  parseEmbeddedAbPlanMode,
} from "@/lib/ai/itinerary-planning";
import {
  parseTripPreferences,
  tripPreferencesToContextInterests,
  type TripInterest,
} from "@/lib/ai/trip-preference";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import { parseTravelDateRangeFromText } from "@/lib/ai/parse-travel-date-range";
import { parseTripDaysFromPendingReply } from "@/lib/ai/bare-number-reply";
import {
  buildCityDaysConfirmedReply,
  buildDateAndDurationQuestionReply,
  pendingQuestionForAskDays,
  pendingQuestionForCityPreference,
} from "@/lib/ai/city-days-planning";
import {
  buildAskTripStyleAdviceResult,
  parseAskTripStyleSelection,
  tripStyleLabel,
  type TripStyleKey,
} from "@/lib/ai/ai-trip-style";
import {
  buildCombinationAllowlistFromTitles,
  buildCombinationSelectionAllowlist,
  getDestinationCombinations,
  pendingOptionTitlesForCombinations,
  resolveSelectedCombinations,
} from "@/lib/ai/destination-combination-suggestions";
import { parseNearbyExtensionsFromText } from "@/lib/ai/combination-selection-reply";
import {
  isKnownCountryLabel,
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
  parseDestinationFromText,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import {
  listChildDestinationsByCountry,
  resolveDestinationEntity,
} from "@/lib/ai/destination-entity";
import { resolveDestinationAlias } from "@/lib/ai/destination-alias-resolver";
import {
  logDestinationCitySelected,
  logDestinationSearchScopeUpdated,
  logConversationStageTransition,
} from "@/lib/ai/destination-scope";
import {
  hasValidTripDuration,
  logConversationStateTransition,
  logTripDurationGuard,
  resolveValidTripDays,
} from "@/lib/ai/trip-duration-guard";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  contextPatchForPreferenceSelection,
  enrichPendingQuestion,
  isAffirmativeReply,
  type ExpectedAnswerType,
  type ConversationState,
} from "@/lib/ai/chat-conversation-state";
import {
  buildDefaultRoutesReply,
  getDestinationStyleGuide,
} from "@/lib/ai/destination-style-guide";
import { logChatContextUpdate, logChatNextStep } from "@/lib/ai/chat-debug-log";
import { parseMonthNumber } from "@/lib/ai/season-response-guardrail";

const FLEXIBLE_REPLY_RE =
  /^(都可以|都行|不限|沒特別|沒有特別|隨意|你推|都行吧|隨便|任何|沒有偏好|沒偏好)$/;

export type PendingQuestionType =
  | "trip_style_choice"
  | "region_choice"
  | "duration_choice"
  | "activity_choice"
  | "preference_choice"
  | "city_style_choice"
  | "destination_style_choice"
  | "combination_choice"
  | "itinerary_next_step"
  | "ask_days"
  | "ask_preference"
  | "ask_trip_style";

export type ItineraryNextStepOption = "full_itinerary" | "daily_recommendations";

export const USE_DEFAULT_ROUTES = "__use_default_routes__";

export type PendingQuestion = {
  type: PendingQuestionType;
  options: string[];
  baseDestination?: string;
  destinationCountry?: string;
  expectedAnswerType?: ExpectedAnswerType;
  conversationState?: ConversationState;
};

const AFFIRMATIVE_TAIL_RE =
  /(好像不錯|好像可以|蠻不錯|蛮不错|不錯|不错|可以|好的|好呀|挺好|就這個|就这个|選這個|选这个|好了|就用|就它|應該可以|应该可以)/;

const OPTION_ALIASES: Record<string, string[]> = {
  城市: ["城市", "城市探索", "城市散策", "市區"],
  美食按摩: ["美食按摩", "美食", "按摩", "夜市", "美食跟按摩"],
  海灘放鬆: ["海灘放鬆", "海灘", "海邊放鬆", "海邊", "看海", "沙灘", "放鬆", "C"],
  跳島: ["跳島", "離島", "島嶼"],
  水上市場: ["水上市場", "水上市集", "丹嫩莎多", "floating market"],
  "曼谷＋芭達雅": [
    "曼谷＋芭達雅",
    "曼谷+芭達雅",
    "曼谷和芭達雅",
    "曼谷跟芭達雅",
    "曼谷加芭達雅",
    "曼谷芭達雅",
    "曼谷、芭達雅",
  ],
  海島放鬆: ["海島放鬆", "海島", "海島度假", "海島行程", "普吉", "蘇梅", "喀比"],
  海邊放鬆: ["海邊放鬆", "海邊", "海灘", "海景", "沙灘"],
  城市散策: ["城市散策", "散策", "城市散步", "慢步調", "古城"],
  首爾: ["首爾", "首尔"],
  釜山: ["釜山"],
  濟州: ["濟州", "济州", "濟州島"],
  城市美食: ["城市美食"],
  經典地標: ["經典地標", "地標", "必去景點"],
  經典景點: ["經典景點", "經典地標", "地標", "景點", "必去景點", "必去", "A"],
  美食咖啡: ["美食咖啡", "美食", "咖啡", "吃的", "B"],
  慢步調散策: ["慢步調", "散策", "慢慢走", "慢旅行"],
  must_visit_places: [
    "必去點",
    "必去點有哪些",
    "有哪些必去",
    "推薦景點",
    "哪些景點一定要去",
    "幫我列景點",
    "先列必去點",
    "必去景點",
    "列出必去點",
    "景點有哪些",
    "列景點",
  ],
  重新生成: ["重新生成", "再生成一次", "再試一次", "重試", "再生一次"],
  daily_rhythm: [
    "總天數節奏",
    "天數節奏",
    "排節奏",
    "先定節奏",
    "前後段節奏",
    "行程節奏",
    "每天怎麼排",
  ],
  full_itinerary: [
    "A",
    "排完整5天",
    "完整5天",
    "直接排",
    "幫我排完整",
    "排完整行程",
    "直接幫你排",
    "排完整",
    "完整五天",
    "完整行程",
    "排完整天",
    "你幫我排",
    "排完整五天",
    "完整5天行程",
  ],
  daily_recommendations: [
    "B",
    "先列必去點",
    "必去點",
    "每天值得去",
    "先推薦地點",
    "列景點",
    "先推薦每一天",
    "每一天值得去",
    "逐日推薦",
    "每天值得去的地點",
  ],
};

function isFlexibleReply(text: string): boolean {
  return FLEXIBLE_REPLY_RE.test(text.trim());
}

export function resolveFlexiblePendingDefault(pending: PendingQuestion): string {
  if (pending.type === "trip_style_choice" && pending.options.includes("城市")) {
    return "城市";
  }
  if (pending.type === "preference_choice") {
    const defaults = ["attractions", "food"].filter((option) => pending.options.includes(option));
    return (defaults.length ? defaults : pending.options.slice(0, 2)).join(",");
  }
  if (pending.type === "activity_choice" && pending.options.includes("must_visit_places")) {
    return "must_visit_places";
  }
  if (pending.type === "city_style_choice") {
    return "__flexible_city_mix__";
  }
  if (pending.type === "destination_style_choice") {
    return USE_DEFAULT_ROUTES;
  }
  if (pending.type === "combination_choice") {
    return pending.options.join("|");
  }
  return pending.options[0] ?? "";
}

export function isFlexiblePreferenceReply(text: string): boolean {
  return isFlexibleReply(text);
}

function preferenceSelectionValue(text: string): string | null {
  const interests = parseTripPreferences(text);
  if (interests.length === 0) return null;
  return interests.join(",");
}

function normalizeOptionText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, "")
    .replace(/\+/g, "＋")
    .toLowerCase();
}

function optionKeywords(option: string): string[] {
  const aliases = OPTION_ALIASES[option] ?? [option];
  return [...new Set([option, ...aliases])];
}

/** Parse "第4個" / "第四個" / "4" → 0-based index. */
function parseOptionOrdinalIndex(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const digit = t.match(
    /^(?:我要|選|选|我想|要|就)?\s*(?:第\s*)?(\d+)\s*(?:個|个|项|項)?\s*(?:那個|那个)?\s*吧?$/,
  );
  if (digit?.[1]) {
    const n = Number(digit[1]);
    return Number.isFinite(n) && n >= 1 ? n - 1 : null;
  }
  const cnMap: Record<string, number> = {
    一: 1,
    二: 2,
    兩: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const cn = t.match(
    /^(?:我要|選|选|我想|要|就)?\s*(?:第\s*)?([一二兩三四五六七八九十两])\s*(?:個|个|项|項)?\s*(?:那個|那个)?\s*吧?$/,
  );
  if (cn?.[1] && cnMap[cn[1]]) return cnMap[cn[1]]! - 1;
  return null;
}

function textMatchesOption(text: string, option: string): boolean {
  const normalized = normalizeOptionText(text);
  for (const keyword of optionKeywords(option)) {
    const key = normalizeOptionText(keyword);
    if (key.length <= 1) {
      if (normalized === key) return true;
      continue;
    }
    if (normalized === key || normalized.includes(key) || (normalized.length >= 2 && key.includes(normalized))) {
      return true;
    }
  }
  return false;
}

const REGION_CHOICE_ENTITY_TYPES = new Set([
  "city",
  "region",
  "island",
  "province",
  "state",
  "resort_area",
  "archipelago",
  "district",
  "administrative_area",
]);

/** Strip trailing duration/date fragments so「福岡6天」still yields 福岡. */
function stripDurationAndDateSuffix(text: string): string {
  return text
    .trim()
    .replace(
      /(?:\d{1,2}\s*[\/\-月]\s*\d{1,2}(?:\s*[\/\-～~至到]\s*\d{1,2}\s*[\/\-月]?\s*\d{1,2})?).*$/u,
      "",
    )
    .replace(/(?:\d+|[一二三四五六七八九十兩两]+)\s*天(?:\s*\d+\s*夜)?.*$/u, "")
    .trim();
}

/**
 * Accept a free-form city/region that was not listed in the previous round's
 * country destination options (e.g. Japan options show 東京/大阪/京都/北海道,
 * user replies 福岡).
 */
export function resolveFreeFormRegionChoice(
  text: string,
  pending: PendingQuestion,
): string | null {
  if (pending.type !== "region_choice") return null;

  const stripped = stripDurationAndDateSuffix(text);
  const countryRaw =
    pending.destinationCountry?.trim() || pending.baseDestination?.trim() || "";
  const country = countryRaw ? normalizeDestinationLabel(countryRaw) : undefined;

  const aliasHit = resolveDestinationAlias(stripped || text.trim(), {
    countryHint: countryRaw || undefined,
  });
  const aliasCanonical =
    // Only trust alias table hits — heuristic fallback returns the raw label unchanged.
    aliasHit &&
    (aliasHit.aliases.length > 1 ||
      Boolean(aliasHit.entityType) ||
      Boolean(aliasHit.countryHint) ||
      aliasHit.searchName !== aliasHit.normalizedName)
      ? aliasHit.normalizedName
      : undefined;

  const raw =
    resolveDestinationFromText(stripped)?.trim() ||
    parseDestinationFromText(stripped)?.trim() ||
    resolveDestinationFromText(text)?.trim() ||
    parseDestinationFromText(text)?.trim() ||
    aliasCanonical?.trim() ||
    undefined;

  let label = raw ? normalizeDestinationLabel(raw) : "";

  // Registered child destinations under the country (covers 塔斯馬尼亞 etc.).
  if (!label && country) {
    const probe = normalizeDestinationLabel(stripped || text.trim());
    if (probe) {
      const children = listChildDestinationsByCountry(country);
      const hit = children.find((child) => {
        const name = normalizeDestinationLabel(child.name);
        return (
          name === probe ||
          name.includes(probe) ||
          probe.includes(name) ||
          textMatchesOption(probe, child.name)
        );
      });
      if (hit) label = normalizeDestinationLabel(hit.name);
    }
  }

  // Alias / registered entity fallback when parsers miss a known place label.
  if (!label) {
    const probe = normalizeDestinationLabel(stripped || text.trim());
    if (probe && probe.length >= 2 && probe.length <= 16) {
      const alias = resolveDestinationAlias(probe, { countryHint: country });
      const aliasOk =
        alias.aliases.length > 1 ||
        Boolean(alias.entityType) ||
        Boolean(alias.countryHint) ||
        alias.searchName !== alias.normalizedName;
      if (aliasOk && alias.normalizedName) {
        label = normalizeDestinationLabel(alias.normalizedName);
      } else {
        const entity = resolveDestinationEntity(probe);
        if (
          REGION_CHOICE_ENTITY_TYPES.has(entity.type) &&
          (!country ||
            !entity.country ||
            normalizeDestinationLabel(entity.country) === country)
        ) {
          const registered = listChildDestinationsByCountry(
            entity.country ?? country ?? "",
          ).some((c) => normalizeDestinationLabel(c.name) === probe);
          if (registered || isKnownTouristCityLabel(probe)) {
            label = probe;
          }
        }
      }
    }
  }

  if (!label) return null;

  // Selecting the country again is not a city answer.
  if (country && label === country) return null;
  if (isKnownCountryLabel(label) && !isKnownTouristCityLabel(label)) return null;

  const entity = resolveDestinationEntity(label);
  const acceptableType =
    REGION_CHOICE_ENTITY_TYPES.has(entity.type) || isKnownTouristCityLabel(label);
  if (!acceptableType) return null;

  const entityCountry = entity.country
    ? normalizeDestinationLabel(entity.country)
    : undefined;
  if (country && entityCountry && entityCountry !== country) {
    return null;
  }

  logAiPipeline(
    "[DESTINATION_SELECTION_RECEIVED]",
    `input=${text.trim()}`,
    `previousState=region_choice`,
    `countryContext=${country ?? ""}`,
  );
  logAiPipeline(
    "[DESTINATION_SELECTION_RESOLVED]",
    `raw=${text.trim()}`,
    `normalized=${label}`,
    `countryCode=${entityCountry ?? country ?? ""}`,
    `entityType=${entity.type}`,
    `hasCoordinates=false`,
  );

  return label;
}

export function isItineraryNextStepPending(pending?: PendingQuestion): boolean {
  if (!pending) return false;
  if (pending.type === "itinerary_next_step") return true;
  return (
    pending.type === "activity_choice" &&
    pending.options.includes("full_itinerary") &&
    pending.options.includes("daily_recommendations")
  );
}

export function parseItineraryNextStepSelection(text: string): ItineraryNextStepOption | null {
  const t = text.trim();
  if (!t) return null;
  const embedded = parseEmbeddedAbPlanMode(t);
  if (embedded) return embedded;
  if (/^a$/i.test(t)) return "full_itinerary";
  if (/^b$/i.test(t)) return "daily_recommendations";

  for (const option of ["daily_recommendations", "full_itinerary"] as const) {
    if (textMatchesOption(t, option)) return option;
  }
  return null;
}

export function isAskDaysPending(pending?: PendingQuestion): boolean {
  return pending?.type === "ask_days" || pending?.type === "duration_choice";
}

export function parseAskDaysFromText(
  text: string,
  pending?: PendingQuestion,
): number | undefined {
  const parsed = parseTripDaysFromPendingReply(text, {
    pendingQuestion: pending ?? { type: "ask_days", options: [] },
    pendingQuestionAlias:
      pending?.type === "ask_days" ? "ask_date_or_duration" : pending?.type,
    conversationStage: "COLLECTING_DATE_AND_DURATION",
  });
  return parsed.days;
}

/** Clarify when a bare/calendar reply is ambiguous under ask_days. */
export function parseAskDaysClarification(
  text: string,
  pending?: PendingQuestion,
): string | undefined {
  const parsed = parseTripDaysFromPendingReply(text, {
    pendingQuestion: pending ?? { type: "ask_days", options: [] },
    pendingQuestionAlias:
      pending?.type === "ask_days" ? "ask_date_or_duration" : pending?.type,
    conversationStage: "COLLECTING_DATE_AND_DURATION",
  });
  return parsed.clarificationReply;
}

export function parsePendingOptionSelection(
  text: string,
  pending: PendingQuestion,
): string | null {
  const t = text.trim();
  if (!t) return null;

  if (pending.type === "ask_days" || pending.type === "duration_choice") {
    // Pending-specific parser first — bare numbers must resolve as tripDays here,
    // never fall through to combination / menu index parsers.
    const days = parseAskDaysFromText(t, pending);
    if (days) return String(days);
  }

  if (pending.type === "ask_trip_style") {
    const style = parseAskTripStyleSelection(t);
    if (style) return style;
  }

  if (pending.type === "combination_choice") {
    const dest = pending.baseDestination ?? "";
    const resolved = resolveSelectedCombinations(dest, t);
    if (resolved?.titles.length) {
      return resolved.titles.join("|");
    }
    // Do NOT silently fall through to "all combinations" via affirmative fluff.
    // Ambiguous text must return null so the UI re-asks.
    return null;
  }

  if (pending.type === "ask_preference") {
    if (/^a$/i.test(t)) return "經典景點";
    if (/^b$/i.test(t)) return "美食咖啡";
    if (/^c$/i.test(t)) return "海灘放鬆";
    if (/^d$/i.test(t) || FLEXIBLE_REPLY_RE.test(t)) return "都可以";
    if (/^(景點|地標|sightseeing)$/i.test(t)) return "經典景點";
    if (/^(購物|shopping)$/i.test(t)) return "購物";
    for (const option of pending.options) {
      if (textMatchesOption(t, option)) return option;
    }
  }

  if (isItineraryNextStepPending(pending)) {
    if (isAffirmativeReply(t) && pending.options.includes("full_itinerary")) {
      return "full_itinerary";
    }
    return parseItineraryNextStepSelection(t);
  }

  if (pending.type === "activity_choice") {
    const planMode = parseItineraryPlanModeIntent(t);
    if (planMode === "full_itinerary" && pending.options.includes("full_itinerary")) {
      return "full_itinerary";
    }
    if (planMode === "daily_recommendations" && pending.options.includes("daily_recommendations")) {
      return "daily_recommendations";
    }
    if (isAffirmativeReply(t)) {
      if (pending.options.includes("full_itinerary")) return "full_itinerary";
      if (pending.options.includes("must_visit_places")) return "must_visit_places";
      if (pending.options.includes("daily_recommendations")) return "daily_recommendations";
    }
    const followUp = parsePlanningFollowUpIntent(t);
    if (followUp && pending.options.includes(followUp)) return followUp;
  }

  if (pending.type === "preference_choice") {
    const preferences = preferenceSelectionValue(t);
    if (preferences) return preferences;
  }

  if (
    pending.type === "region_choice" ||
    pending.type === "destination_style_choice" ||
    pending.type === "city_style_choice" ||
    pending.type === "trip_style_choice"
  ) {
    const ordinal = parseOptionOrdinalIndex(t);
    if (ordinal != null && pending.options[ordinal]) {
      return pending.options[ordinal]!;
    }
  }

  if (pending.type === "destination_style_choice") {
    const indexMatch = t.match(/^(\d)[\.、)]?$/);
    if (indexMatch) {
      const index = Number(indexMatch[1]) - 1;
      if (pending.options[index]) return pending.options[index];
    }
    if (FLEXIBLE_REPLY_RE.test(t)) {
      return resolveFlexiblePendingDefault(pending);
    }
  }

  const sorted = [...pending.options].sort((a, b) => b.length - a.length);
  for (const option of sorted) {
    if (textMatchesOption(t, option)) return option;
  }

  const stripped = t.replace(AFFIRMATIVE_TAIL_RE, "").trim();
  if (stripped && stripped !== t) {
    for (const option of sorted) {
      if (textMatchesOption(stripped, option)) return option;
    }
  }

  // Free-form city under country options (福岡 when options are 東京/大阪/京都/北海道).
  // Must run before flexible/affirmative defaults so we never coerce a city name
  // into the first listed option.
  if (pending.type === "region_choice") {
    const freeForm = resolveFreeFormRegionChoice(t, pending);
    if (freeForm) return freeForm;
  }

  if (FLEXIBLE_REPLY_RE.test(t) || AFFIRMATIVE_TAIL_RE.test(t)) {
    for (const option of sorted) {
      if (textMatchesOption(t, option)) return option;
    }
    if (pending.options.length > 0) {
      return resolveFlexiblePendingDefault(pending);
    }
  }

  return null;
}

export function applyDestinationPendingSelection(
  text: string,
  session: ChatPlanningSession,
): {
  session: ChatPlanningSession;
  contextPatch: Partial<CanonicalTravelContext>;
  selectedOption?: string;
} {
  const pending = session.pendingQuestion;
  if (!pending) {
    return { session, contextPatch: {} };
  }

  const selected = parsePendingOptionSelection(text, pending);
  if (!selected) {
    return { session, contextPatch: {} };
  }

  const contextPatch = buildContextPatchForSelection(
    selected,
    pending,
    session.travelContext,
    text,
  );
  if (pending.type === "ask_days" || pending.type === "duration_choice") {
    logAiPipeline(
      "[PENDING_QUESTION_CLEARED]",
      `previous=${pending.type === "ask_days" ? "ask_date_or_duration" : pending.type}`,
    );
  }
  return {
    session: {
      ...session,
      pendingQuestion: undefined,
      adviceSelectionThisTurn: selected,
      lastResolvedPendingQuestion: pending,
    },
    contextPatch,
    selectedOption: selected,
  };
}

function buildThailandTripStylePatch(
  selected: string,
  country?: string,
): Partial<CanonicalTravelContext> {
  const destinationCountry = country ?? "泰國";
  const base: Partial<CanonicalTravelContext> = {
    selectedTripStyle: selected,
    travelStyle: selected,
    destinationCountry,
    tripPurpose: "trip_style_selected",
  };

  if (selected === "城市") {
    return {
      ...base,
      destination: "曼谷",
      destinationCities: ["曼谷"],
    };
  }

  if (selected === "美食按摩") {
    return {
      ...base,
      destination: "曼谷",
      destinationCities: ["曼谷"],
      vibe: "美食按摩",
      interests: ["美食", "按摩", "夜市"],
    };
  }

  if (selected === "海島放鬆") {
    return {
      ...base,
      destination: "普吉島",
      destinationCities: ["普吉島", "喀比", "蘇梅島"],
      vibe: "海島放鬆",
      interests: ["海島", "海邊", "放鬆"],
    };
  }

  return base;
}

function buildContextPatchForSelection(
  selected: string,
  pending: PendingQuestion,
  sessionContext?: CanonicalTravelContext | null,
  userText?: string,
): Partial<CanonicalTravelContext> {
  const country = pending.destinationCountry;
  const base: Partial<CanonicalTravelContext> = {
    selectedTripStyle: selected,
    travelStyle: selected,
  };

  if (pending.type === "trip_style_choice" && pending.options.includes("城市")) {
    return buildThailandTripStylePatch(selected, country);
  }

  if (selected === "曼谷＋芭達雅") {
    return {
      ...base,
      destination: "曼谷＋芭達雅",
      destinationCountry: country ?? "泰國",
      destinationCities: ["曼谷", "芭達雅"],
      tripPurpose: "route_combination_selected",
    };
  }

  if (selected === "海灘放鬆" || selected === "跳島" || selected === "水上市場") {
    return {
      ...base,
      destination: pending.baseDestination ?? "芭達雅",
      destinationCountry: country ?? "泰國",
      tripPurpose: "trip_style_selected",
      vibe: selected,
    };
  }

  if (pending.type === "duration_choice") {
    const days = parseDayCountFromText(selected) ?? parseDayCountFromText(selected.replace(/\s/g, ""));
    return {
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country ?? pending.destinationCountry,
      days,
      planningDaysConfirmed: true,
      tripPurpose: "duration_selected",
      conversationState: "awaiting_preference",
    };
  }

  if (pending.type === "ask_days") {
    const range = parseTravelDateRangeFromText(selected);
    const days = range.days ?? (Number(selected) || parseDayCountFromText(selected));
    return {
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country ?? pending.destinationCountry,
      days,
      ...(range.startDate && /^\d{4}-\d{2}-\d{2}$/.test(range.startDate)
        ? { startDate: range.startDate }
        : {}),
      ...(range.endDate && /^\d{4}-\d{2}-\d{2}$/.test(range.endDate)
        ? { endDate: range.endDate }
        : {}),
      planningDaysConfirmed: true,
      tripPurpose: "duration_selected",
      conversationState: "awaiting_preference",
    };
  }

  if (pending.type === "combination_choice") {
    const titles = selected
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
    const dest = pending.baseDestination ?? base.destination;
    const allowlist = dest
      ? buildCombinationAllowlistFromTitles(dest, titles) ??
        buildCombinationSelectionAllowlist(dest, titles.join("、"))
      : null;
    const nearbyExtensions = userText
      ? parseNearbyExtensionsFromText(userText, dest)
      : [];
    return {
      ...base,
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country ?? pending.destinationCountry,
      selectedTripStyle: titles.join("、"),
      travelStyle: titles.join("、"),
      selectedCombinationIds: allowlist?.selectedCombinationIds,
      selectedCombinationPlaceNames: allowlist?.allowedPlaceNames,
      excludedCombinationPlaceNames: allowlist?.exclusiveExcludedPlaceNames,
      selectionSource: allowlist?.selectionSource,
      ...(nearbyExtensions.length
        ? {
            nearbyExtensions,
            unresolvedNearbyExtensions: nearbyExtensions,
          }
        : {}),
      tripPurpose: "route_combination_selected",
      conversationState: "ready_for_itinerary",
    };
  }

  if (pending.type === "ask_trip_style") {
    const style = selected as TripStyleKey;
    return {
      ...base,
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country ?? pending.destinationCountry,
      planningDaysConfirmed: true,
      planningTripStyle: style,
      selectedTripStyle: tripStyleLabel(style),
      travelStyle: tripStyleLabel(style),
      tripPurpose: "trip_style_selected",
      conversationState: "preference_selected",
    };
  }

  if (pending.type === "ask_preference") {
    return contextPatchForPreferenceSelection(selected, pending);
  }

  if (selected === USE_DEFAULT_ROUTES) {
    return {
      ...base,
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country ?? pending.destinationCountry,
      useDefaultRecommendation: true,
      vibe: "混合",
      travelStyle: "熱門路線",
      tripPurpose: "destination_style_default",
    };
  }

  if (pending.type === "destination_style_choice") {
    return {
      ...base,
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country ?? pending.destinationCountry,
      vibe: selected,
      travelStyle: selected,
      tripPurpose: "trip_style_selected",
    };
  }

  if (selected === "must_visit_places") {
    return {
      ...base,
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country,
      tripPurpose: "must_visit_places",
    };
  }

  if (selected === "full_itinerary") {
    return {
      ...base,
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country,
      selectedPlanMode: "full_itinerary",
      conversationState: "ready_for_itinerary",
      tripPurpose: "direct_itinerary_generation",
    };
  }

  if (selected === "daily_recommendations") {
    return {
      ...base,
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country,
      selectedPlanMode: "daily_recommendations",
      conversationState: "itinerary_draft",
      tripPurpose: "itinerary_draft",
    };
  }

  if (selected === "daily_rhythm") {
    return {
      ...base,
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country,
      tripPurpose: "daily_rhythm",
    };
  }

  if (pending.type === "preference_choice") {
    const interests = selected.split(",").filter(Boolean) as TripInterest[];
    return {
      ...base,
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country,
      selectedInterests: interests,
      interests: tripPreferencesToContextInterests(interests),
      conversationState: "ready_for_itinerary",
      tripPurpose: "ready_for_itinerary",
    };
  }

  if (pending.type === "city_style_choice") {
    return {
      ...base,
      destination: pending.baseDestination ?? base.destination,
      destinationCountry: country,
      tripPurpose: "city_style_selected",
      vibe: selected === "__flexible_city_mix__" ? "混搭" : selected,
      travelStyle: selected === "__flexible_city_mix__" ? "混搭" : selected,
    };
  }

  if (pending.type === "region_choice") {
    const city = selected === "__flexible_city_mix__" ? pending.options[0] : selected;
    const countryLabel = country ?? pending.destinationCountry;
    const selectedLabel = city ? normalizeDestinationLabel(city) : undefined;
    const selectedEntity = selectedLabel
      ? resolveDestinationEntity(selectedLabel)
      : undefined;
    const isRegionLike =
      selectedEntity?.type === "island" ||
      selectedEntity?.type === "region" ||
      selectedEntity?.type === "province" ||
      selectedEntity?.type === "state" ||
      selectedEntity?.type === "resort_area";
    if (city) {
      const monthNum = parseMonthNumber(sessionContext?.travelMonth);
      logDestinationCitySelected({ country: countryLabel, city });
      logAiPipeline(
        "[CITY_SELECTION_CONFIRMED]",
        `country=${countryLabel ? normalizeDestinationLabel(countryLabel) : "unknown"}`,
        `city=${normalizeDestinationLabel(city)}`,
        `entityType=${selectedEntity?.type ?? "city"}`,
        `month=${monthNum ?? "none"}`,
      );
      logDestinationSearchScopeUpdated({
        from: "country",
        to: isRegionLike ? "region" : "city",
        city,
      });
      logConversationStageTransition(
        "AWAITING_CITY_SELECTION",
        "COLLECTING_DATE_AND_DURATION",
      );
    }
    return {
      ...base,
      destination: city,
      destinationCountry: countryLabel,
      destinationType: selectedEntity?.type ?? "city",
      destinationCity: isRegionLike ? undefined : city,
      destinationRegion: isRegionLike ? selectedLabel : undefined,
      tripPurpose: "region_selected",
      conversationState: "awaiting_days",
      planningDaysConfirmed: false,
    };
  }

  return {
    ...base,
    destination: pending.baseDestination,
    destinationCountry: country,
    tripPurpose: "option_selected",
  };
}

export function buildNextStepAfterAdviceSelection(
  selected: string,
  pending: PendingQuestion,
  ctx: CanonicalTravelContext,
): { reply: string; pendingQuestion?: PendingQuestion } {
  if (pending.type === "ask_days") {
    const days =
      Number(selected) ||
      parseDayCountFromText(selected) ||
      parseAskDaysFromText(selected, pending) ||
      ctx.days;
    const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
    if (ctx.days != null && ctx.days > 0 && !days) {
      logAiPipeline(
        "[ASK_DAYS_TEMPLATE_BLOCKED]",
        "reason=trip_days_already_resolved",
        `tripDays=${ctx.days}`,
      );
      return buildCityDaysConfirmedReply(
        dest,
        ctx.days,
        pending.destinationCountry ?? ctx.destinationCountry,
        {
          weather: ctx.weather,
          context: {
            ...ctx,
            destination: normalizeDestinationLabel(dest),
            days: ctx.days,
          },
        },
      );
    }
    if (!days) {
      return {
        reply: `好，${dest}是很好的選擇。你這趟大概幾天？`,
        pendingQuestion: pendingQuestionForAskDays(
          dest,
          pending.destinationCountry ?? ctx.destinationCountry,
        ),
      };
    }
    logChatContextUpdate({ destination: dest, days });
    logAiPipeline(
      "[PENDING_QUESTION_CLEARED]",
      "previous=ask_date_or_duration",
    );
    const label = normalizeDestinationLabel(dest);
    // Always New Trip Conversation: destination combinations (never legacy trip style).
    return buildCityDaysConfirmedReply(
      dest,
      days,
      pending.destinationCountry ?? ctx.destinationCountry,
      { weather: ctx.weather, context: { ...ctx, destination: label, days } },
    );
  }

  if (pending.type === "combination_choice") {
    const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
    const titles = selected
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
    const labelList = titles.length ? titles.join("、") : "建議組合";
    return {
      reply: [
        `好，我會以${labelList}為主，幫你安排${dest}${ctx.days ? ` ${ctx.days} 天` : ""}行程。`,
        "我正在確認實際地點、營業時間與順路動線。",
      ].join("\n"),
      pendingQuestion: undefined,
    };
  }

  if (pending.type === "ask_preference") {
    const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
    const days = ctx.days;
    const style = selected === "都可以" ? "混合" : selected;
    if (!days) {
      return {
        reply: `好，那我會把${dest}排成${style}方向。你這趟大概幾天？`,
        pendingQuestion: pendingQuestionForAskDays(
          dest,
          pending.destinationCountry ?? ctx.destinationCountry,
        ),
      };
    }
    return {
      reply: [
        `好，那我會把${dest} ${days} 天排成${style}方向。`,
        "接下來我會先給你幾組行程組合，回覆有興趣的組合，我再幫你生成行程。",
      ].join("\n"),
      pendingQuestion: pendingQuestionForCombinationChoice(
        dest,
        pending.destinationCountry ?? ctx.destinationCountry,
      ),
    };
  }

  if (pending.type === "destination_style_choice") {
    const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
    if (selected === USE_DEFAULT_ROUTES) {
      const { reply, durationOptions } = buildDefaultRoutesReply(
        dest,
        pending.destinationCountry ?? ctx.destinationCountry,
      );
      return {
        reply,
        pendingQuestion: {
          type: "duration_choice",
          options: durationOptions,
          baseDestination: dest,
          destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
        },
      };
    }

    const guide = getDestinationStyleGuide(dest);
    const durationOptions = guide.durationOptions ?? ["5 天", "7 天", "10 天"];
    return {
      reply: [
        `好，那我會幫你把${dest}排成${selected}方向。`,
        `我會先抓${dest}適合${selected}的經典區域，節奏不會排太滿。`,
        "你這趟大概想排幾天？",
      ].join("\n"),
      pendingQuestion: {
        type: "duration_choice",
        options: durationOptions,
        baseDestination: dest,
        destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
      },
    };
  }

  if (pending.type === "region_choice") {
    const city = selected === "__flexible_city_mix__" ? pending.options[0] ?? selected : selected;
    const country = pending.destinationCountry ?? ctx.destinationCountry;
    const cityCtx: CanonicalTravelContext = {
      ...ctx,
      destination: city,
      destinationCountry: country,
      destinationType: "city",
    };
    const validDays = resolveValidTripDays(cityCtx);
    logTripDurationGuard({
      tripDays: validDays ?? ctx.days ?? null,
      startDate: ctx.startDate,
      endDate: ctx.endDate,
      valid: validDays != null,
      nextState: validDays != null ? "awaiting_combination_selection" : "waitingTripDays",
    });

    // Case G/H: destination + days/dates arrived together — skip re-asking duration.
    if (hasValidTripDuration(cityCtx) && validDays != null) {
      logConversationStateTransition({
        from: "region_choice",
        to: "awaiting_combination_selection",
        reason: "destination_selected_duration_present",
      });
      return buildCityDaysConfirmedReply(city, validDays, country, {
        weather: ctx.weather,
        context: { ...cityCtx, days: validDays, planningDaysConfirmed: true },
      });
    }

    logConversationStateTransition({
      from: "region_choice",
      to: "waitingTripDays",
      reason: "destination_selected_duration_missing",
    });
    // City confirmed → collect date/days. Never travel-style / landmark intro.
    return buildDateAndDurationQuestionReply(city, country, {
      context: cityCtx,
      userText: selected,
      previousPendingType: "region_choice",
      blockedLegacyTemplate:
        city === "釜山" || city === "首爾" || city === "濟州"
          ? "korea_city_style_followup"
          : "city_preference_or_style_followup",
    });
  }

  if (pending.type === "city_style_choice") {
    // Legacy pending: ignore style answer and force date/duration collection.
    const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
    return buildDateAndDurationQuestionReply(
      dest,
      pending.destinationCountry ?? ctx.destinationCountry,
      {
        context: { ...ctx, destination: dest },
        userText: selected,
        previousPendingType: "city_style_choice",
        blockedLegacyTemplate: "city_style_choice",
      },
    );
  }

  if (pending.type === "trip_style_choice" && pending.options.includes("城市")) {
    if (selected === "城市") {
      return {
        reply: [
          "那我會比較建議你以曼谷為主。",
          "曼谷很適合安排美食、按摩、夜市、市集、寺廟和城市散步。",
          "如果第一次去，通常 4～5 天會比較剛好。",
          "你這趟大概想排幾天？",
        ].join("\n"),
        pendingQuestion: {
          type: "duration_choice",
          options: ["4 天", "5 天", "6 天"],
          baseDestination: "曼谷",
          destinationCountry: pending.destinationCountry ?? "泰國",
        },
      };
    }

    if (selected === "美食按摩") {
      return {
        reply: [
          "那我會建議以曼谷為主，很適合排美食、按摩和夜市。",
          "可以混搭米其林小吃、路邊攤、按摩店和河畔夜市，節奏不會太趕。",
          "如果第一次去，通常 4～5 天會比較剛好。",
          "你這趟大概想排幾天？",
        ].join("\n"),
        pendingQuestion: {
          type: "duration_choice",
          options: ["4 天", "5 天", "6 天"],
          baseDestination: "曼谷",
          destinationCountry: pending.destinationCountry ?? "泰國",
        },
      };
    }

    if (selected === "海島放鬆") {
      return {
        reply: [
          "那我會比較建議往普吉、喀比或蘇梅島方向排。",
          "這幾個地方都很適合海灘放空、跳島和度假村節奏，第一次通常 5～7 天比較剛好。",
          "你這趟大概想排幾天？",
        ].join("\n"),
        pendingQuestion: {
          type: "duration_choice",
          options: ["5 天", "6 天", "7 天"],
          baseDestination: "普吉島",
          destinationCountry: pending.destinationCountry ?? "泰國",
        },
      };
    }
  }

  if (selected === "曼谷＋芭達雅") {
    return {
      reply: [
        "曼谷＋芭達雅很適合排 5～6 天。",
        "我會建議前半段住曼谷，安排美食、按摩、夜市和水上市場；後半段去芭達雅放鬆、看海或跳島。",
        "你這趟比較想排幾天？我可以先幫你抓一版 4 天、5 天或 6 天的節奏。",
      ].join("\n"),
      pendingQuestion: {
        type: "duration_choice",
        options: ["4 天", "5 天", "6 天"],
        baseDestination: "曼谷＋芭達雅",
        destinationCountry: pending.destinationCountry ?? "泰國",
      },
    };
  }

  if (selected === "海灘放鬆") {
    return {
      reply: [
        `好，以${pending.baseDestination ?? "芭達雅"}為主，我會幫你排海灘放鬆路線。`,
        "通常 2～3 天可以安排沙灘、海景餐廳和傍晚散步，節奏不會太趕。",
        "你這趟大概幾天？想偏重度假村放空，還是每天換不同海灘？",
      ].join("\n"),
      pendingQuestion: {
        type: "duration_choice",
        options: ["2 天", "3 天", "4 天"],
        baseDestination: pending.baseDestination ?? "芭達雅",
        destinationCountry: pending.destinationCountry ?? "泰國",
      },
    };
  }

  if (selected === "跳島") {
    return {
      reply: [
        `好，${pending.baseDestination ?? "芭達雅"}附近有不少跳島選擇，通常會排半日或一日船程。`,
        "我會建議先抓 3～4 天，留 1～2 天給跳島，其餘時間在海灘或市區放鬆。",
        "你這趟大概幾天？",
      ].join("\n"),
      pendingQuestion: {
        type: "duration_choice",
        options: ["3 天", "4 天", "5 天"],
        baseDestination: pending.baseDestination ?? "芭達雅",
        destinationCountry: pending.destinationCountry ?? "泰國",
      },
    };
  }

  if (selected === "水上市場") {
    return {
      reply: [
        "水上市場通常會搭配曼谷或近郊半日遊最順。",
        "若你想專攻水上市場，我建議 2～3 天曼谷＋近郊，或 4 天曼谷＋芭達雅各排一段。",
        "你比較想排幾天？",
      ].join("\n"),
      pendingQuestion: {
        type: "duration_choice",
        options: ["2 天", "3 天", "4 天"],
        baseDestination: pending.baseDestination ?? "曼谷",
        destinationCountry: pending.destinationCountry ?? "泰國",
      },
    };
  }

  if (selected === "must_visit_places") {
    const dest = pending.baseDestination ?? ctx.destination;
    const mustVisit = resolveMustVisitAdvice(
      { ...ctx, destination: dest, days: ctx.days },
      "必去點",
    );
    if (mustVisit) {
      return {
        reply: mustVisit.reply,
      };
    }
    const reply = buildMustVisitPlacesReply({
      ...ctx,
      destination: dest,
      days: ctx.days,
    });
    if (reply) {
      return { reply };
    }
  }

  if (selected === "daily_rhythm") {
    const reply = buildDailyRhythmReply({
      ...ctx,
      destination: pending.baseDestination ?? ctx.destination,
      days: ctx.days,
    });
    if (reply) return { reply };
  }

  if (pending.type === "preference_choice" || selected.includes(",")) {
    const interests = selected.split(",").filter(Boolean) as TripInterest[];
    const reply = buildItineraryPlanningReply(
      {
        ...ctx,
        destination: pending.baseDestination ?? ctx.destination,
        days: ctx.days,
      },
      interests,
    );
    if (reply) {
      return {
        reply,
        pendingQuestion: pendingQuestionForItineraryAction(
          pending.baseDestination ?? ctx.destination ?? "曼谷",
          pending.destinationCountry ?? ctx.destinationCountry,
        ),
      };
    }
  }

  if (selected === "full_itinerary") {
    const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
    const days = ctx.days ?? parseDayCountFromText(selected);
    const reply = itineraryGenerationStatusReply({ ...ctx, destination: dest, days: days ?? ctx.days });
    if (reply) return { reply };
  }

  if (selected === "daily_recommendations") {
    const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
    const interests = (ctx.selectedInterests ?? []) as TripInterest[];
    const reply = buildDailyRecommendationsReply(
      { ...ctx, destination: dest, days: ctx.days },
      interests,
    );
    if (reply) return { reply };
  }

  if (pending.type === "duration_choice") {
    const days =
      parseDayCountFromText(selected) ??
      parseAskDaysFromText(selected, pending) ??
      ctx.days;
    const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
    if (ctx.days != null && ctx.days > 0 && !days) {
      logAiPipeline(
        "[ASK_DAYS_TEMPLATE_BLOCKED]",
        "reason=trip_days_already_resolved",
        `tripDays=${ctx.days}`,
      );
      return buildCityDaysConfirmedReply(
        dest,
        ctx.days,
        pending.destinationCountry ?? ctx.destinationCountry,
        {
          weather: ctx.weather,
          context: {
            ...ctx,
            destination: normalizeDestinationLabel(dest),
            days: ctx.days,
          },
        },
      );
    }
    if (!days) {
      return {
        reply: `好，${dest}是很好的選擇。你這趟大概幾天？`,
        pendingQuestion: pendingQuestionForAskDays(
          dest,
          pending.destinationCountry ?? ctx.destinationCountry,
        ),
      };
    }
    // Same as ask_days: city + days → combination selection.
    return buildCityDaysConfirmedReply(
      dest,
      days,
      pending.destinationCountry ?? ctx.destinationCountry,
      { weather: ctx.weather, context: { ...ctx, destination: normalizeDestinationLabel(dest), days } },
    );
  }

  const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
  const days = ctx.days ?? parseDayCountFromText(selected);
  if (days) {
    return {
      reply: [
        `好的，我會依${dest} ${days} 天的方向繼續幫你規劃。`,
        "你比較想先定每天節奏，還是直接列出必去點？",
      ].join("\n"),
      pendingQuestion: pendingQuestionForPlanningNextStep(
        dest,
        pending.destinationCountry ?? ctx.destinationCountry,
      ),
    };
  }

  return {
    reply: `好的，我會繼續幫你規劃${dest}這趟行程。你這趟大概幾天？`,
    pendingQuestion: {
      type: "duration_choice",
      options: ["3 天", "4 天", "5 天"],
      baseDestination: dest,
      destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
    },
  };
}

export function pendingQuestionForDestinationStyleChoice(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  const guide = getDestinationStyleGuide(baseDestination);
  return enrichPendingQuestion({
    type: "destination_style_choice",
    options: guide.styleOptions,
    baseDestination,
    destinationCountry,
  });
}

export function pendingQuestionForCityStyleChoice(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "city_style_choice",
    options: ["海邊放鬆", "美食", "城市散策"],
    baseDestination,
    destinationCountry,
  });
}

export function pendingQuestionForKoreaRegionChoice(
  destinationCountry = "韓國",
): PendingQuestion {
  return pendingQuestionForCountryRegionChoice(destinationCountry, ["首爾", "釜山", "濟州"]);
}

/** Generic country → city/region pending (options from country advice or caller). */
export function pendingQuestionForCountryRegionChoice(
  destinationCountry: string,
  options?: string[],
): PendingQuestion {
  const country = normalizeDestinationLabel(destinationCountry);
  const fallbackByCountry: Record<string, string[]> = {
    韓國: ["首爾", "釜山", "濟州"],
    日本: ["東京", "大阪", "京都", "北海道"],
    泰國: ["曼谷", "清邁", "普吉島", "蘇梅島"],
    法國: ["巴黎", "普羅旺斯", "蔚藍海岸"],
    越南: ["河內", "峴港", "胡志明"],
    義大利: ["羅馬", "佛羅倫斯", "米蘭", "威尼斯"],
    台灣: ["台北", "台中", "花蓮"],
    美國: ["紐約", "洛杉磯", "舊金山", "拉斯維加斯"],
    英國: ["倫敦", "愛丁堡", "曼徹斯特", "湖區"],
    荷蘭: ["阿姆斯特丹", "鹿特丹", "海牙", "烏得勒支"],
    德國: ["柏林", "慕尼黑", "漢堡", "科隆"],
    西班牙: ["巴塞隆納", "馬德里", "塞維亞", "瓦倫西亞"],
    澳洲: ["雪梨", "墨爾本", "布里斯本", "黃金海岸"],
    加拿大: ["溫哥華", "多倫多", "蒙特婁", "班夫"],
    蒙古: ["烏蘭巴托", "特勒吉", "戈壁"],
    新加坡: ["濱海灣", "牛車水", "聖淘沙"],
  };
  const cleanOptions = (options?.length ? options : fallbackByCountry[country] ?? [])
    .map((o) => {
      const t = o.trim();
      if (/濟州/.test(t)) return "濟州";
      if (/佛羅倫斯|佛罗伦萨/.test(t)) return "佛羅倫斯";
      if (/胡志明/.test(t)) return "胡志明";
      return normalizeDestinationLabel(t);
    })
    .filter(Boolean);

  return enrichPendingQuestion({
    type: "region_choice",
    options: cleanOptions.length
      ? cleanOptions
      : fallbackByCountry[country] ?? [],
    destinationCountry: country,
  });
}

export function pendingQuestionForTripPreference(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "preference_choice",
    options: ["attractions", "shopping", "food", "night_market"],
    baseDestination,
    destinationCountry,
  });
}

export function pendingQuestionForPlanningNextStep(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "activity_choice",
    options: ["must_visit_places", "full_itinerary"],
    baseDestination,
    destinationCountry,
  });
}

export function pendingQuestionForCombinationChoice(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  const label = normalizeDestinationLabel(baseDestination);
  const options = pendingOptionTitlesForCombinations(label);
  return enrichPendingQuestion({
    type: "combination_choice",
    options: options.length ? options : ["都可以"],
    baseDestination: label,
    destinationCountry,
  });
}

export function pendingQuestionForItineraryAction(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "itinerary_next_step",
    options: ["full_itinerary", "daily_recommendations"],
    baseDestination,
    destinationCountry,
  });
}

export function pendingQuestionForThailandTripStyleChoice(
  destinationCountry = "泰國",
): PendingQuestion {
  return enrichPendingQuestion({
    type: "trip_style_choice",
    options: ["城市", "美食按摩", "海島放鬆"],
    destinationCountry,
  });
}

export function pendingQuestionForPattayaStyleChoice(
  destinationCountry = "泰國",
): PendingQuestion {
  return enrichPendingQuestion({
    type: "trip_style_choice",
    options: ["海灘放鬆", "跳島", "水上市場", "曼谷＋芭達雅"],
    baseDestination: "芭達雅",
    destinationCountry,
  });
}

export function inferPendingQuestionFromAdviceReply(
  reply: string,
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): PendingQuestion | undefined {
  if (reply.includes("也可以直接跟我說偏好，或回「都可以」讓我依熱門路線推薦")) {
    const dest = ctx.destination ?? session.travelContext?.destination ?? session.tripPlanningContext?.destination;
    if (dest) {
      return pendingQuestionForDestinationStyleChoice(
        dest,
        ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      );
    }
  }

  if (reply.includes("海邊放鬆、美食，還是城市散策")) {
    // Legacy city-style question text — force date/duration instead.
    const dest =
      ctx.destination ?? session.travelContext?.destination ?? "釜山";
    return pendingQuestionForAskDays(
      dest,
      ctx.destinationCountry ?? session.travelContext?.destinationCountry ?? "韓國",
    );
  }

  if (reply.includes("首爾") && reply.includes("釜山") && reply.includes("濟州")) {
    return pendingQuestionForKoreaRegionChoice(
      ctx.destinationCountry ?? session.travelContext?.destinationCountry ?? "韓國",
    );
  }

  if (
    (reply.includes("曼谷") && reply.includes("清邁") && (reply.includes("普吉") || reply.includes("蘇梅"))) ||
    reply.includes("城市、美食按摩，還是海島放鬆")
  ) {
    // Country-level Thailand always asks concrete cities (legacy style text → still region_choice).
    return pendingQuestionForCountryRegionChoice(
      ctx.destinationCountry ?? session.travelContext?.destinationCountry ?? "泰國",
      ["曼谷", "清邁", "普吉島", "蘇梅島"],
    );
  }

  if (reply.includes("海灘放鬆、跳島、水上市場，還是曼谷＋芭達雅")) {
    return pendingQuestionForPattayaStyleChoice(ctx.destinationCountry ?? "泰國");
  }

  if (reply.includes("4 天、5 天或 6 天")) {
    return {
      type: "duration_choice",
      options: ["4 天", "5 天", "6 天"],
      baseDestination: ctx.destination ?? session.travelContext?.destination,
      destinationCountry: ctx.destinationCountry,
    };
  }

  if (reply.includes("先定總天數節奏，還是先列出必去點")) {
    return pendingQuestionForPlanningNextStep(
      ctx.destination ?? session.travelContext?.destination ?? "這趟",
      ctx.destinationCountry ?? session.travelContext?.destinationCountry,
    );
  }

  if (reply.includes("先推薦必去景點，還是直接幫你排")) {
    const dest =
      ctx.destination ??
      session.travelContext?.destination ??
      session.tripPlanningContext?.destination;
    if (dest) {
      return pendingQuestionForPlanningNextStep(
        dest,
        ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      );
    }
  }

  if (reply.includes("文化景點、購物美食，還是夜市")) {
    return pendingQuestionForTripPreference(
      ctx.destination ?? session.travelContext?.destination ?? "曼谷",
      ctx.destinationCountry ?? session.travelContext?.destinationCountry,
    );
  }

  if (reply.includes("你比較偏：") && reply.includes("A. 經典景點")) {
    const dest = ctx.destination ?? session.travelContext?.destination ?? session.tripPlanningContext?.destination;
    if (dest) {
      return pendingQuestionForCityPreference(
        dest,
        ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      );
    }
  }

  if (
    reply.includes("你這趟大概幾天") ||
    reply.includes("你目前有預計的旅行日期或天數嗎") ||
    reply.includes("你這趟大概想排幾天")
  ) {
    const dest = ctx.destination ?? session.travelContext?.destination ?? session.tripPlanningContext?.destination;
    if (dest) {
      return pendingQuestionForAskDays(
        dest,
        ctx.destinationCountry ?? session.travelContext?.destinationCountry,
      );
    }
  }

  if (reply.includes("我直接幫你排完整") && reply.includes("我先推薦每一天")) {
    return pendingQuestionForItineraryAction(
      ctx.destination ?? session.travelContext?.destination ?? "曼谷",
      ctx.destinationCountry ?? session.travelContext?.destinationCountry,
    );
  }

  return undefined;
}
