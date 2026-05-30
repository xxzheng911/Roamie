import type { ChatMsg } from "@/lib/chat-history";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { placeDisplayName } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { mergeTravelContext, parseTravelContextFromText } from "@/lib/ai/travel-context";
import { applyTripIntentToSession } from "@/lib/recommendation/trip-intent";
import {
  extractDiscoveryFromText,
  extractPlanningHintsFromText,
} from "@/lib/chat-session";
import { extractChatPlanningContextFromText } from "@/lib/chat-planning-flow";
import {
  formatTravelSeasonForAi,
  inferTravelSeason,
  parseMonthNumber,
} from "@/lib/ai/travel-season";
import { formatWeather } from "@/lib/ai/context";
import { resolveCleanDestination } from "@/lib/ai/normalize-destination";
import {
  syncConversationState,
  type ConversationState,
} from "@/lib/ai/conversation-state";

/** 每次聊天累積的旅遊顧問記憶（sessionStorage + 每輪 AI prompt） */
export type ConversationContext = {
  destination?: string;
  travelDate?: string;
  travelDateEnd?: string;
  travelDays?: number;
  travelMonth?: string;
  travelSeason?: string;
  seasonHighlights?: string[];
  weather?: string;
  transportation?: string;
  budget?: string;
  companions?: string;
  mood?: string;
  selectedPlaces: string[];
  /** 上一輪討論焦點（代名詞「那裡」解析用） */
  lastDiscussedPlace?: string;
  /** 「那附近」解析後的搜尋錨點 */
  nearbyAnchor?: string;
  interests?: string[];
  outfitSuggestion?: string;
  updatedAt: string;
};

export const CHAT_HISTORY_TURNS_FOR_AI = 20;

const PRONOUN_NEARBY =
  /^(那附近|那邊|那里|那裡|這附近|這一帶|這邊|附近還有|附近呢|周邊|周圍|旁邊)/;

const PLACE_MENTION =
  /([\u4e00-\u9fffA-Za-z0-9·・]{2,20}(?:城|寺|神社|公園|塔|橋|市場|博物館|美術館|車站|站|商圈|通|街|巷|里|町|島|海灘|海灘|湖|山|展望台|水族館|樂園|百貨|mall|Mall|Center|center))/;

function sticky<T>(prev: T | undefined, next: T | undefined): T | undefined {
  if (next != null && next !== "") return next;
  return prev;
}

function transportLabel(mode?: string): string | undefined {
  if (!mode) return undefined;
  if (mode === "drive") return "自駕";
  if (mode === "walk") return "步行";
  if (mode === "transit") return "大眾運輸";
  return mode;
}

function companionLabel(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (raw === "女友" || raw === "男友") return "情侶";
  if (raw === "家人") return "家人";
  if (raw === "朋友") return "朋友";
  if (raw === "一個人") return "獨旅";
  return raw;
}

function parsePlaceMention(text: string): string | undefined {
  const t = text.trim();
  const go = t.match(
    /(?:去|到|在|逛|參觀|看)([\u4e00-\u9fffA-Za-z0-9·・]{2,20}(?:城|寺|神社|公園|塔|橋|市場|博物館|美術館|車站|站|商圈|通|街|巷|里|町|島)?)/,
  );
  if (go?.[1] && go[1].length >= 2) return go[1].trim();
  const m = t.match(PLACE_MENTION);
  if (m?.[1] && m[1].length >= 2) return m[1].trim();
  return undefined;
}

function lastAssistantFocus(msgs: ChatMsg[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "assistant") continue;
    const recs = m.roamie?.recommendations;
    if (recs?.length) return recs[0]?.placeName ?? recs[0]?.name;
    const summary = m.roamie?.summary ?? m.content;
    const hit = summary.match(PLACE_MENTION);
    if (hit?.[1]) return hit[1].trim();
  }
  return undefined;
}

function resolveNearbyAnchor(
  userText: string,
  session: ChatPlanningSession,
  msgs: ChatMsg[],
): string | undefined {
  if (!PRONOUN_NEARBY.test(userText.trim())) return undefined;
  const prev = session.conversationContext?.lastDiscussedPlace;
  const anchor =
    prev ??
    lastAssistantFocus(msgs) ??
    session.selectedPlaces[0]?.name ??
    session.recommendedPlaces[0]?.name;
  return anchor;
}

function buildFromTravel(
  travel: CanonicalTravelContext,
  session: ChatPlanningSession,
  userText: string,
): Partial<ConversationContext> {
  const monthNum = parseMonthNumber({
    travelMonth: travel.travelMonth,
    startDate: travel.startDate,
    travelDate: session.travelDate,
    userText,
  });
  const season = inferTravelSeason({
    destination: travel.destination,
    month: monthNum,
    userText,
  });

  return {
    destination: travel.destination,
    travelDate: travel.startDate ?? session.travelDate,
    travelDateEnd: travel.endDate ?? session.tripEndDate,
    travelDays: travel.days ?? session.tripDays,
    travelMonth: travel.travelMonth ?? (monthNum ? `${monthNum}月` : undefined),
    travelSeason: season?.seasonLabel,
    seasonHighlights: season?.seasonHighlights,
    weather: session.weather ? formatWeather(session.weather) : undefined,
    transportation: transportLabel(travel.transportMode ?? session.transportation),
    budget: travel.budgetLevel ?? session.budget,
    companions: companionLabel(travel.companion ?? session.discovery?.companionship),
    mood: travel.mood ?? session.selectedMood ?? session.mood,
    selectedPlaces: session.selectedPlaces.map(placeDisplayName),
    interests: travel.interests.length ? travel.interests : undefined,
    outfitSuggestion: season?.outfitSuggestion,
  };
}

/** 單輪更新 conversation_context（send 流程每則使用者訊息後呼叫） */
export function updateConversationContext(
  session: ChatPlanningSession,
  userText: string,
  msgs: ChatMsg[],
): ChatPlanningSession {
  const travel = session.travelContext;
  const parsed = parseTravelContextFromText(userText, session);
  const placeMention = parsePlaceMention(userText);
  const nearbyAnchor = resolveNearbyAnchor(userText, session, msgs);

  const partial = buildFromTravel(
    { ...(travel ?? { interests: [] }), ...parsed, interests: [...(travel?.interests ?? []), ...(parsed.interests ?? [])] },
    session,
    userText,
  );

  const cleanDest =
    resolveCleanDestination(userText, {
      rawDestination: partial.destination,
      sessionDestination: travel?.destination ?? session.travelContext?.destination,
      preferredArea: session.preferredArea,
    }) ?? partial.destination;

  const prev = session.conversationContext;
  const nextCtx: ConversationContext = {
    destination: sticky(prev?.destination, cleanDest),
    travelDate: sticky(prev?.travelDate, partial.travelDate),
    travelDateEnd: sticky(prev?.travelDateEnd, partial.travelDateEnd),
    travelDays: sticky(prev?.travelDays, partial.travelDays),
    travelMonth: sticky(prev?.travelMonth, partial.travelMonth),
    travelSeason: sticky(prev?.travelSeason, partial.travelSeason),
    seasonHighlights: partial.seasonHighlights?.length
      ? [...new Set([...(prev?.seasonHighlights ?? []), ...partial.seasonHighlights])]
      : prev?.seasonHighlights,
    weather: partial.weather ?? prev?.weather,
    transportation: sticky(prev?.transportation, partial.transportation),
    budget: sticky(prev?.budget, partial.budget),
    companions: sticky(prev?.companions, partial.companions),
    mood: sticky(prev?.mood, partial.mood),
    selectedPlaces: partial.selectedPlaces?.length ? partial.selectedPlaces : (prev?.selectedPlaces ?? []),
    lastDiscussedPlace: placeMention ?? prev?.lastDiscussedPlace,
    nearbyAnchor: nearbyAnchor ?? (placeMention ? placeMention : prev?.nearbyAnchor),
    interests: partial.interests?.length
      ? [...new Set([...(prev?.interests ?? []), ...partial.interests])]
      : prev?.interests,
    outfitSuggestion: partial.outfitSuggestion ?? prev?.outfitSuggestion,
    updatedAt: new Date().toISOString(),
  };

  let nextSession: ChatPlanningSession = {
    ...session,
    conversationContext: nextCtx,
  };

  if (nearbyAnchor) {
    nextSession = {
      ...nextSession,
      preferredArea: `${nearbyAnchor}附近`,
    };
  }

  nextSession = syncConversationState(nextSession, userText);
  return {
    ...nextSession,
    conversationSummary: formatConversationContextForAi(
      nextSession.conversationContext,
      nextSession.conversationState,
    ),
  };
}

/** 從完整對話紀錄重建 session + context（載入 Supabase 歷史後） */
export function rehydrateSessionFromMessages(
  session: ChatPlanningSession,
  msgs: ChatMsg[],
): ChatPlanningSession {
  let next = session;
  const userMsgs = msgs.filter((m) => m.role === "user" && m.content.trim());
  for (const m of userMsgs) {
    const text = m.content.trim();
    next = applyTripIntentToSession(text, next);
    const merged = mergeTravelContext(next, text);
    next = merged.session;
    next = extractPlanningHintsFromText(text, next);
    next = extractDiscoveryFromText(text, next);
    next = extractChatPlanningContextFromText(text, next);
    next = updateConversationContext(next, text, msgs);
  }
  const focus = lastAssistantFocus(msgs);
  if (focus && next.conversationContext) {
    next = {
      ...next,
      conversationContext: {
        ...next.conversationContext,
        lastDiscussedPlace: next.conversationContext.lastDiscussedPlace ?? focus,
      },
    };
  }
  return next;
}

export function formatConversationContextForAi(
  ctx: ConversationContext | undefined,
  planning?: ConversationState,
): string {
  if (!ctx && !planning?.destination) return "";
  const lines: string[] = ["【Conversation Memory — 必須遵守，不得忽略】"];
  const priority = [
    ["目的地", planning?.destination ?? ctx?.destination],
    ["旅遊日期", ctx?.travelDate],
    ["結束日期", ctx?.travelDateEnd],
    [
      "天數",
      planning?.days != null
        ? `${planning.days} 天`
        : ctx?.travelDays != null
          ? `${ctx.travelDays} 天`
          : undefined,
    ],
    ["月份", planning?.month ?? ctx?.travelMonth],
    ["季節", ctx?.travelSeason],
    ["季節亮點", ctx?.seasonHighlights?.join("、")],
    ["天氣", ctx?.weather],
    ["交通", ctx?.transportation],
    ["預算", ctx?.budget],
    ["同行", ctx?.companions],
    ["心情", ctx?.mood],
    [
      "興趣",
      planning?.preferences.length
        ? planning.preferences.join("、")
        : ctx?.interests?.join("、"),
    ],
    ["已選地點", ctx?.selectedPlaces?.join("、")],
    ["討論焦點", ctx?.lastDiscussedPlace],
    ["附近錨點", ctx?.nearbyAnchor],
    ["穿搭", ctx?.outfitSuggestion],
    ["規劃階段", planning?.stage],
    [
      "偏好彈性",
      planning?.flexiblePreference ? "是（可綜合安排放鬆、拍照、美食）" : undefined,
    ],
  ] as const;
  for (const [label, value] of priority) {
    if (value != null && String(value).trim()) lines.push(`${label}：${value}`);
  }
  lines.push(
    "規則：回覆優先依序 — (1) 使用者當前訊息 (2) 上述已知目的地 (3) 日期/季節 (4) 交通 (5) 預算 (6) 同行 (7) 心情。「那附近」= 附近錨點或討論焦點，勿換城市。季節錯誤（如 12 月推櫻花）禁止。",
  );
  const seasonBlock = inferTravelSeason({
    destination: planning?.destination ?? ctx?.destination,
    month: parseMonthNumber({
      travelMonth: planning?.month ?? ctx?.travelMonth,
      startDate: ctx?.travelDate,
    }),
    userText: "",
  });
  if (seasonBlock) {
    lines.push("【季節推算】\n" + formatTravelSeasonForAi(seasonBlock));
  }
  return lines.join("\n");
}

export function buildConversationContextBlock(
  session: ChatPlanningSession,
): string {
  return formatConversationContextForAi(
    session.conversationContext,
    session.conversationState,
  );
}

/** System-level Known Travel Context (Supabase-backed fields). */
export function formatKnownTravelContextForPrompt(
  ctx: ConversationContext | undefined,
): string {
  if (!ctx) return "";
  const season =
    ctx.travelSeason && ctx.seasonHighlights?.length
      ? `${ctx.travelSeason}（${ctx.seasonHighlights.join("、")}）`
      : ctx.travelSeason ?? ctx.travelMonth;

  const lines = ["【Known Travel Context — persistent memory, do not ignore】"];
  const fields: [string, string | undefined][] = [
    ["Destination", ctx.destination],
    ["Travel Date", ctx.travelDate],
    ["Travel Days", ctx.travelDays != null ? `${ctx.travelDays}` : undefined],
    ["Season", season],
    ["Weather", ctx.weather],
    ["Transportation", ctx.transportation],
    ["Companions", ctx.companions],
    ["Budget", ctx.budget],
    ["Mood", ctx.mood],
    [
      "Selected Places",
      ctx.selectedPlaces?.length ? ctx.selectedPlaces.join("、") : undefined,
    ],
  ];
  for (const [label, value] of fields) {
    if (value?.trim()) lines.push(`${label}: ${value.trim()}`);
  }
  if (ctx.lastDiscussedPlace) lines.push(`Discussion focus: ${ctx.lastDiscussedPlace}`);
  if (ctx.nearbyAnchor) lines.push(`Nearby anchor: ${ctx.nearbyAnchor}`);
  lines.push(
    "Rules: Latest user message can refine but not silently erase the above.「那附近」= Nearby anchor or Discussion focus.",
  );
  return lines.join("\n");
}

export function buildKnownTravelContextPayload(
  ctx: ConversationContext | undefined,
): import("@/lib/conversation-context-sync.server").KnownTravelContextPayload | undefined {
  if (!ctx) return undefined;
  const season =
    ctx.travelSeason && ctx.seasonHighlights?.length
      ? `${ctx.travelSeason}（${ctx.seasonHighlights.join("、")}）`
      : ctx.travelSeason ?? ctx.travelMonth;
  return {
    destination: ctx.destination,
    travelDate: ctx.travelDate,
    travelDays: ctx.travelDays,
    season,
    weather: ctx.weather,
    budget: ctx.budget,
    transportation: ctx.transportation,
    companions: ctx.companions,
    mood: ctx.mood,
    selectedPlaces: ctx.selectedPlaces,
    sessionExtras: {
      travelDateEnd: ctx.travelDateEnd,
      travelMonth: ctx.travelMonth,
      seasonHighlights: ctx.seasonHighlights,
      lastDiscussedPlace: ctx.lastDiscussedPlace,
      nearbyAnchor: ctx.nearbyAnchor,
      interests: ctx.interests,
      outfitSuggestion: ctx.outfitSuggestion,
    },
  };
}
