import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import { enrichPendingQuestion } from "@/lib/ai/chat-conversation-state";
import {
  buildDestinationCombinationSuggestionsReply,
  pendingOptionTitlesForCombinations,
} from "@/lib/ai/destination-combination-suggestions";
import {
  normalizeDestinationLabel,
  isKnownCountryLabel,
  isKnownTouristCityLabel,
} from "@/lib/ai/trip-planning-context";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { EN_CITY_NAMES } from "@/lib/ai/destination-geocode";
import { buildLocalLifeSearchAttempts, buildLocalLifeSupplementAttempts } from "@/lib/ai/ai-local-life-rules";
import { parseTravelDateRangeFromText } from "@/lib/ai/parse-travel-date-range";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  resolveConversationDays,
  resolveConversationDestination,
} from "@/lib/ai/ai-chat-conversation-state";

export type TripStyleKey = "classic_landmarks" | "local_life" | "slow_nature" | "mixed";

export const CHAT_DAY_PLAN_MIN_PER_DAY = 3;
export const CHAT_DAY_PLAN_MAX_PER_DAY = 5;

export type TripStyleOption = {
  key: TripStyleKey;
  label: string;
  shortLabel: string;
};

export const TRIP_STYLE_OPTIONS: TripStyleOption[] = [
  {
    key: "classic_landmarks",
    label: "經典地標（適合第一次去）",
    shortLabel: "經典地標",
  },
  {
    key: "local_life",
    label: "在地商圈市集走訪（感受在地生活與小吃）",
    shortLabel: "在地生活體驗",
  },
  {
    key: "slow_nature",
    label: "慢步調散策（公園河岸、咖啡廳與文創）",
    shortLabel: "慢步調散策",
  },
  {
    key: "mixed",
    label: "Roamie 幫我混搭推薦",
    shortLabel: "Roamie 混搭推薦",
  },
];

export function logAiTripStyleOptionsRender(): void {
  logAiPipeline("[AI_TRIP_STYLE_OPTIONS_RENDER]");
}

export function logAiTripStyleSelected(option: TripStyleKey): void {
  logAiPipeline("[AI_TRIP_STYLE_SELECTED]", `option=${option}`);
}

export function logAiPlaceSearchStart(
  destination: string,
  style: TripStyleKey,
  days: number,
): void {
  logAiPipeline(
    "[AI_PLACE_SEARCH_START]",
    `destination=${destination}`,
    `style=${style}`,
    `days=${days}`,
  );
}

export function logAiPlaceSearchResults(count: number): void {
  logAiPipeline("[AI_PLACE_SEARCH_RESULTS]", `count=${count}`);
}

export function logAiDayPlanGenerated(day: number, count: number): void {
  logAiPipeline("[AI_DAY_PLAN_GENERATED]", `day=${day}`, `count=${count}`);
}

export function logAiStylePlanGenerateStart(
  destination: string,
  style: TripStyleKey,
  days: number,
  sessionId?: string,
): void {
  logAiPipeline(
    "[AI_STYLE_PLAN_GENERATE_START]",
    `destination=${destination}`,
    `style=${style}`,
    `days=${days}`,
    sessionId ? `sessionId=${sessionId}` : "",
  );
}

export function logAiStyleSearchAttempts(destination: string, style: TripStyleKey, count: number): void {
  logAiPipeline(
    "[AI_STYLE_SEARCH_ATTEMPTS]",
    `destination=${destination}`,
    `style=${style}`,
    `count=${count}`,
  );
}

export function logAiStylePlacesResult(count: number, source?: string): void {
  logAiPipeline(
    "[AI_STYLE_PLACES_RESULT]",
    `count=${count}`,
    source ? `source=${source}` : "",
  );
}

export function logAiStyleDayPlanResult(days: number, itemCount: number): void {
  logAiPipeline("[AI_STYLE_DAY_PLAN_RESULT]", `days=${days}`, `items=${itemCount}`);
}

export function logAiStylePlanApplySession(sessionId: string): void {
  logAiPipeline("[AI_STYLE_PLAN_APPLY_SESSION]", `sessionId=${sessionId}`);
}

export function logAiStylePlanRenderReady(places: number, dayPlanItems: number): void {
  logAiPipeline("[AI_STYLE_PLAN_RENDER_READY]", `places=${places}`, `dayPlan=${dayPlanItems}`);
}

export function hasConfirmedTripDays(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): boolean {
  if (session?.pendingQuestion?.type === "ask_days") return false;

  const days = resolveInferredTripDays(ctx, session);
  if (!days || days <= 0) return false;

  if (ctx.planningDaysConfirmed === false && !hasTripDateRange(ctx, session)) {
    return false;
  }

  return true;
}

export function resolveConfirmedDays(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
  userText?: string,
): number | undefined {
  if (!hasConfirmedTripDays(ctx, session)) return undefined;
  return resolveInferredTripDays(ctx, session, userText);
}

export function resolveTripStyleFromContext(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): TripStyleKey | undefined {
  const raw =
    ctx.planningTripStyle ??
    session?.travelContext?.planningTripStyle ??
    parseTripStyleKey(ctx.selectedTripStyle ?? ctx.travelStyle);
  return raw;
}

export function resolveTripStartDate(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): string | undefined {
  return (
    ctx.startDate?.trim() ||
    session?.tripStartDate?.trim() ||
    session?.travelContext?.startDate?.trim() ||
    session?.tripPlanningContext?.startDate?.trim() ||
    undefined
  );
}

export function resolveTripEndDate(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): string | undefined {
  return (
    ctx.endDate?.trim() ||
    session?.tripEndDate?.trim() ||
    session?.travelContext?.endDate?.trim() ||
    session?.tripPlanningContext?.endDate?.trim() ||
    undefined
  );
}

export function hasTripDateRange(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): boolean {
  return Boolean(resolveTripStartDate(ctx, session) && resolveTripEndDate(ctx, session));
}

export function inferDaysFromDateRange(
  startDate?: string | null,
  endDate?: string | null,
): number | undefined {
  const start = startDate?.trim();
  const end = endDate?.trim();
  if (!start || !end) return undefined;

  const startMs = Date.parse(`${start}T00:00:00`);
  const endMs = Date.parse(`${end}T00:00:00`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return undefined;

  const dayMs = 24 * 60 * 60 * 1000;
  return Math.min(30, Math.max(1, Math.round((endMs - startMs) / dayMs) + 1));
}

/** Resolve trip days from explicit count or a complete start/end date range. */
export function resolveInferredTripDays(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
  userText?: string,
): number | undefined {
  if (ctx.days != null && ctx.days > 0) return ctx.days;

  const fromDates = inferDaysFromDateRange(
    resolveTripStartDate(ctx, session),
    resolveTripEndDate(ctx, session),
  );
  if (fromDates) return fromDates;

  const sessionDays = session?.tripDays ?? session?.tripPlanningContext?.days;
  if (sessionDays != null && sessionDays > 0) return sessionDays;

  if (userText?.trim()) {
    const range = parseTravelDateRangeFromText(userText);
    if (range.days && range.days > 0) return range.days;
  }

  return undefined;
}

export function enrichTripDatesInContext(
  text: string,
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): Partial<CanonicalTravelContext> {
  const fromText = text.trim() ? parseTravelDateRangeFromText(text) : {};
  const startDate =
    fromText.startDate ??
    resolveTripStartDate(ctx, session);
  const endDate =
    fromText.endDate ??
    resolveTripEndDate(ctx, session);
  const days =
    fromText.days ??
    resolveInferredTripDays(ctx, session);

  const patch: Partial<CanonicalTravelContext> = {};
  if (startDate) patch.startDate = startDate;
  if (endDate) patch.endDate = endDate;
  if (days && days > 0) {
    patch.days = days;
    if (startDate && endDate) {
      patch.planningDaysConfirmed = true;
    }
  }
  return patch;
}

export function hasCompleteTripPlanningContext(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): boolean {
  return Boolean(
    resolveConversationDestination(ctx, session) && hasConfirmedTripDays(ctx, session),
  );
}

export function shouldAskTripDuration(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
  userText?: string,
): boolean {
  if (!resolveConversationDestination(ctx, session)) return false;
  if (hasConfirmedTripDays(ctx, session)) return false;
  if (resolveInferredTripDays(ctx, session, userText)) return false;
  if (ctx.mustVisitGenerated) return false;

  const dest = resolveConversationDestination(ctx, session);
  if (dest) {
    const label = normalizeDestinationLabel(dest);
    if (
      isKnownCountryLabel(label) &&
      !isKnownTouristCityLabel(label) &&
      !hasTripDateRange(ctx, session)
    ) {
      return false;
    }
  }

  return true;
}

export function shouldAskTripStyle(
  _ctx: CanonicalTravelContext,
  _session?: ChatPlanningSession,
  _userText?: string,
): boolean {
  // Legacy Trip Conversation (classic_landmarks / local_life / slow_nature / mixed)
  // has been retired. Destination planning always uses New Trip Conversation
  // (dynamic destination combinations) instead.
  return false;
}

export function pendingQuestionForAskTripDuration(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "ask_days",
    options: ["1", "2", "3", "4"],
    baseDestination,
    destinationCountry,
  });
}

export function buildAskTripDurationReply(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): string {
  const destination = resolveConversationDestination(ctx, session) ?? "這趟";
  const label = normalizeDestinationLabel(destination);
  return [
    `你預計去${label}玩幾天呢？`,
    "例如：",
    "• 一日遊",
    "• 2天1夜",
    "• 3天2夜",
    "• 4天以上",
  ].join("\n");
}

export function buildAskTripDurationAdviceResult(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): {
  reply: string;
  pendingQuestion: PendingQuestion;
  contextPatch: Partial<CanonicalTravelContext>;
} {
  const destination = resolveConversationDestination(ctx, session)!;
  return {
    reply: buildAskTripDurationReply(ctx, session),
    pendingQuestion: pendingQuestionForAskTripDuration(
      destination,
      ctx.destinationCountry ?? session?.travelContext?.destinationCountry,
    ),
    contextPatch: {
      destination,
      planningDaysConfirmed: false,
      tripPurpose: "awaiting_trip_duration",
      conversationState: "awaiting_days",
    },
  };
}

export function pendingQuestionForAskTripStyle(
  baseDestination: string,
  destinationCountry?: string,
): PendingQuestion {
  return enrichPendingQuestion({
    type: "ask_trip_style",
    options: TRIP_STYLE_OPTIONS.map((option) => option.key),
    baseDestination,
    destinationCountry,
  });
}

export function buildAskTripStyleReply(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
  userText?: string,
): string {
  // Legacy 1~4 style options removed — redirect callers toward combination copy.
  const destination = resolveConversationDestination(ctx, session) ?? "這趟";
  const days = resolveConfirmedDays(ctx, session, userText);
  const label = normalizeDestinationLabel(destination);
  if (!days) {
    return buildAskTripDurationReply(ctx, session);
  }
  return [
    `好，我先記下 ${label} ${days} 天行程方向。`,
    "接下來我會依目的地給你幾組動態行程組合，回覆你比較有興趣的組合即可。",
  ].join("\n");
}

export function buildTripStyleSelectionAdviceResult(
  style: TripStyleKey,
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): {
  reply: string;
  triggerPlaceRecommendations: true;
  contextPatch: Partial<CanonicalTravelContext>;
} {
  const destination = resolveConversationDestination(ctx, session) ?? ctx.destination ?? "這趟";
  const label = normalizeDestinationLabel(destination);
  const days = resolveConfirmedDays(ctx, session) ?? ctx.days;
  logAiTripStyleSelected(style);
  return {
    reply: `好的，我會依「${tripStyleLabel(style)}」幫你安排 ${label}${days ? ` ${days} 天` : ""}行程。`,
    triggerPlaceRecommendations: true,
    contextPatch: {
      destination: label,
      days,
      planningDaysConfirmed: true,
      planningTripStyle: style,
      selectedTripStyle: tripStyleLabel(style),
      travelStyle: tripStyleLabel(style),
      tripPurpose: "trip_style_selected",
      conversationState: "preference_selected",
      startDate: ctx.startDate ?? session?.tripStartDate,
      endDate: ctx.endDate ?? session?.tripEndDate,
    },
  };
}

export function buildAskTripStyleAdviceResult(
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
  userText?: string,
): {
  reply: string;
  pendingQuestion: PendingQuestion;
  contextPatch: Partial<CanonicalTravelContext>;
} {
  // Legacy style selection retired — upgrade to New Trip Conversation combinations.
  const destination = resolveConversationDestination(ctx, session)!;
  const days = resolveConfirmedDays(ctx, session, userText) ?? ctx.days ?? 3;
  const label = normalizeDestinationLabel(destination);
  const hasExactDate =
    Boolean(ctx.startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(ctx.startDate!.trim()) &&
    Boolean(ctx.endDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(ctx.endDate!.trim());
  const reply =
    buildDestinationCombinationSuggestionsReply(label, days, {
      startDate: hasExactDate ? ctx.startDate : undefined,
      endDate: hasExactDate ? ctx.endDate : undefined,
      weatherLine: `好，我先記下 ${label} ${days} 天行程方向。`,
    }) ?? buildAskTripStyleReply(ctx, session, userText);

  const comboOptions = pendingOptionTitlesForCombinations(label);
  return {
    reply,
    pendingQuestion: enrichPendingQuestion({
      type: "combination_choice",
      options: comboOptions.length ? comboOptions : ["都可以"],
      baseDestination: label,
      destinationCountry: ctx.destinationCountry ?? session?.travelContext?.destinationCountry,
    }),
    contextPatch: {
      destination: label,
      days,
      planningDaysConfirmed: true,
      startDate: resolveTripStartDate(ctx, session),
      endDate: resolveTripEndDate(ctx, session),
      tripPurpose: "combination_suggestions_offered",
      conversationState: "awaiting_preference",
      mustVisitGenerated: true,
      planningStage: "recommendations_generated",
    },
  };
}

export function parseTripStyleKey(value?: string | null): TripStyleKey | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  const direct = TRIP_STYLE_OPTIONS.find(
    (option) =>
      option.key === normalized ||
      option.key === value ||
      option.label === value ||
      option.shortLabel === value,
  );
  if (direct) return direct.key;

  if (/經典|地標|第一次|①|1/.test(value) && /經典|地標|第一次/.test(value)) {
    return "classic_landmarks";
  }
  if (/在地|商圈|市集|小吃|文青|②/.test(value)) return "local_life";
  if (/文化|自然|慢|療癒|③/.test(value)) return "slow_nature";
  if (/混搭|順路|直接|④|都可以|預設/.test(value)) return "mixed";

  return undefined;
}

export function parseAskTripStyleSelection(text: string): TripStyleKey | null {
  const t = text.trim();
  if (!t) return null;

  const indexMatch = t.match(/^(\d)[\.、)]?$/);
  if (indexMatch) {
    const index = Number(indexMatch[1]) - 1;
    const option = TRIP_STYLE_OPTIONS[index];
    if (option) return option.key;
  }

  for (const option of TRIP_STYLE_OPTIONS) {
    if (t.includes(option.label) || t.includes(option.shortLabel)) {
      return option.key;
    }
  }

  return parseTripStyleKey(t) ?? null;
}

export function tripStyleLabel(style: TripStyleKey): string {
  return TRIP_STYLE_OPTIONS.find((option) => option.key === style)?.shortLabel ?? style;
}

/** 推薦卡片標籤用（與行程風格選項對應） */
export function tripStyleDisplayTag(style: TripStyleKey): string {
  const tags: Record<TripStyleKey, string> = {
    classic_landmarks: "經典地標",
    local_life: "在地生活",
    slow_nature: "慢步調散策",
    mixed: "Roamie混搭",
  };
  return tags[style];
}

export function buildTripStyleSearchAttempts(
  destination: string,
  style: TripStyleKey,
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[label];
  const enQueries: SearchAttempt[] = en && en !== label
    ? [
        { query: `${en} tourist attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
        { query: `${en} landmarks`, mode: "text", includedTypes: ["tourist_attraction", "historical_landmark"] },
        { query: `${en} scenic spots`, mode: "text", includedTypes: ["tourist_attraction", "park", "natural_feature"] },
      ]
    : [];

  const classic: SearchAttempt[] = [
    { query: `${label} 熱門景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 地標`, mode: "text", includedTypes: ["tourist_attraction", "historical_landmark"] },
    { query: `${label} 觀光景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 自然景點`, mode: "text", includedTypes: ["park", "natural_feature", "tourist_attraction"] },
    { query: `${label} 博物館`, mode: "text", includedTypes: ["museum", "art_gallery"] },
    { query: `${label} 海岸景點`, mode: "text", includedTypes: ["tourist_attraction", "natural_feature"] },
    { query: `${label} 餐廳`, mode: "text", includedTypes: ["restaurant"] },
  ];

  const localLife = buildLocalLifeSearchAttempts(label);

  const slowNature: SearchAttempt[] = [
    { query: `${label} 博物館`, mode: "text", includedTypes: ["museum"] },
    { query: `${label} 美術館`, mode: "text", includedTypes: ["art_gallery", "museum"] },
    { query: `${label} 自然景觀`, mode: "text", includedTypes: ["park", "natural_feature"] },
    { query: `${label} 步道`, mode: "text", includedTypes: ["park", "tourist_attraction"] },
    { query: `${label} 日落`, mode: "text", includedTypes: ["tourist_attraction", "observation_deck"] },
    { query: `${label} 河岸`, mode: "text", includedTypes: ["park", "tourist_attraction"] },
  ];

  if (style === "classic_landmarks") return [...classic, ...enQueries];
  if (style === "local_life") return localLife;
  if (style === "slow_nature") return [...slowNature, ...enQueries];

  return [...classic, ...localLife, ...slowNature, ...enQueries];
}

export function buildTripStyleSupplementAttempts(
  destination: string,
  style: TripStyleKey,
  pass: number,
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const generic: SearchAttempt[] = [
    { query: `${label} 景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 美食`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${label} 咖啡`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${label} 購物`, mode: "text", includedTypes: ["shopping_mall"] },
  ];
  if (pass === 0) return buildTripStyleSearchAttempts(destination, style);
  if (style === "classic_landmarks") {
    const label = normalizeDestinationLabel(destination);
    return [
      { query: `${label} 必去`, mode: "text", includedTypes: ["tourist_attraction", "point_of_interest"] },
      { query: `${label} 觀光`, mode: "text", includedTypes: ["tourist_attraction"] },
      { query: `${label} 古蹟`, mode: "text", includedTypes: ["tourist_attraction", "museum"] },
    ];
  }
  if (style === "local_life") {
    return buildLocalLifeSupplementAttempts(destination, pass, []);
  }
  if (pass === 1) return generic;
  return [
    { query: `${label} 必去`, mode: "text", includedTypes: ["tourist_attraction", "point_of_interest"] },
    { query: `${label} 推薦`, mode: "text", includedTypes: ["tourist_attraction", "restaurant"] },
  ];
}

export type DayPlanBucket = {
  day: number;
  names: string[];
};

export function computeDayPlanTargetCount(days: number): number {
  return Math.max(1, days) * CHAT_DAY_PLAN_MAX_PER_DAY;
}

export function distributeRecommendationsAcrossDays(
  recommendations: RoamieRecommendationItem[],
  days: number,
): DayPlanBucket[] {
  const safeDays = Math.max(1, days);
  const perDay = Math.min(
    CHAT_DAY_PLAN_MAX_PER_DAY,
    Math.max(
      CHAT_DAY_PLAN_MIN_PER_DAY,
      Math.ceil(recommendations.length / safeDays),
    ),
  );
  const buckets: DayPlanBucket[] = Array.from({ length: safeDays }, (_, index) => ({
    day: index + 1,
    names: [],
  }));

  let dayIndex = 0;
  for (const rec of recommendations) {
    const name = rec.name?.trim();
    if (!name) continue;
    while (dayIndex < safeDays && buckets[dayIndex]!.names.length >= perDay) {
      dayIndex += 1;
    }
    if (dayIndex >= safeDays) break;
    buckets[dayIndex]!.names.push(name);
  }

  for (const bucket of buckets) {
    logAiDayPlanGenerated(bucket.day, bucket.names.length);
  }

  return buckets;
}

export function buildDayPlanSummaryFromBuckets(
  destination: string,
  days: number,
  style: TripStyleKey,
  buckets: DayPlanBucket[],
): string {
  const label = normalizeDestinationLabel(destination);
  const styleLabel = tripStyleLabel(style);
  const lines: string[] = [
    `${label} ${days} 天推薦（${styleLabel}）：`,
    "",
  ];

  for (const bucket of buckets) {
    if (!bucket.names.length) continue;
    lines.push(`Day${bucket.day}：`);
    for (const name of bucket.names) {
      lines.push(`- ${name}`);
    }
    if (bucket.day < days) lines.push("");
  }

  lines.push("", "想加進行程的話，可以跟我說「加入全部」或選幾個最想去的。");
  return lines.join("\n");
}

export function mergeDateRangeIntoContext(
  text: string,
  ctx: CanonicalTravelContext,
  session?: ChatPlanningSession,
): Partial<CanonicalTravelContext> {
  return enrichTripDatesInContext(text, ctx, session);
}
