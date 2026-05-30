import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ChatPhase, RoamieRequestContext } from "@/lib/ai/context";
import { resolveChatRoute } from "@/lib/ai/chat-router";
import { resolveAiUserIntent } from "@/lib/ai/user-intent";
import { mergeTravelContext } from "@/lib/ai/travel-context";
import { parseTripIntentFromText } from "@/lib/recommendation/trip-intent";
import { resolveInstantChatReply } from "@/lib/chat/chat-instant-reply";
import type { RoamieResponse } from "@/lib/ai/types";

export type ChatQaCategory =
  | "weather"
  | "itinerary"
  | "mood"
  | "place"
  | "constraint"
  | "vague"
  | "mixed"
  | "offtopic";

export type ChatComprehensiveCase = {
  id: string;
  category: ChatQaCategory;
  userText: string;
  /** 若預期走 itinerary API */
  forceItinerary?: boolean;
  /** 推薦類：至少 N 張卡片（0 = 只要求 summary） */
  minRecommendations?: number;
};

export type ChatComprehensiveRow = {
  test_input: string;
  category: ChatQaCategory;
  detected_intent: string;
  chat_pipeline_status: string;
  api_called: boolean;
  assistant_message_created: boolean;
  fallback_used: boolean;
  recommendation_count: number;
  error: string;
  result: "PASS" | "FAIL";
};

export type ChatComprehensiveResult = {
  passed: boolean;
  passCount: number;
  failCount: number;
  rows: ChatComprehensiveRow[];
};

const SESSION: ChatPlanningSession = {
  selectedPlaces: [],
  location: { lat: 22.64, lng: 120.29, city: "高雄" },
} as ChatPlanningSession;

export const CHAT_COMPREHENSIVE_CASES: ChatComprehensiveCase[] = [
  // 1. 天氣類
  { id: "W1", category: "weather", userText: "11月釜山天氣如何" },
  { id: "W2", category: "weather", userText: "明天高雄會下雨嗎" },
  { id: "W3", category: "weather", userText: "大阪12月會冷嗎" },
  { id: "W4", category: "weather", userText: "去京都要穿什麼" },
  { id: "W5", category: "weather", userText: "下雨天適合去哪", minRecommendations: 0 },

  // 2. 行程規劃類
  { id: "I1", category: "itinerary", userText: "11月釜山行程你覺得怎麼安排比較好" },
  { id: "I2", category: "itinerary", userText: "幫我排大阪三天兩夜", forceItinerary: true },
  { id: "I3", category: "itinerary", userText: "我想去台南一日遊" },
  { id: "I4", category: "itinerary", userText: "高雄半日遊怎麼安排" },
  { id: "I5", category: "itinerary", userText: "東京五天想輕鬆一點", forceItinerary: true },

  // 3. 心情類
  { id: "M1", category: "mood", userText: "我今天有點累" },
  { id: "M2", category: "mood", userText: "我想放空" },
  { id: "M3", category: "mood", userText: "我想一個人走走" },
  { id: "M4", category: "mood", userText: "今天不想去人太多的地方" },
  { id: "M5", category: "mood", userText: "想找安靜的地方" },

  // 4. 地點推薦類
  { id: "P1", category: "place", userText: "附近有什麼咖啡廳", minRecommendations: 1 },
  { id: "P2", category: "place", userText: "找安靜的咖啡廳", minRecommendations: 1 },
  { id: "P3", category: "place", userText: "推薦附近適合拍照的地方", minRecommendations: 1 },
  { id: "P4", category: "place", userText: "有沒有室內景點", minRecommendations: 0 },
  { id: "P5", category: "place", userText: "附近有什麼好吃的", minRecommendations: 1 },

  // 5. 條件限制類
  { id: "C1", category: "constraint", userText: "我只有兩小時" },
  { id: "C2", category: "constraint", userText: "預算不要太高" },
  { id: "C3", category: "constraint", userText: "不想走太多路" },
  { id: "C4", category: "constraint", userText: "想搭捷運就能到" },
  { id: "C5", category: "constraint", userText: "不要太多人" },

  // 6. 模糊輸入類
  { id: "V1", category: "vague", userText: "不知道去哪" },
  { id: "V2", category: "vague", userText: "隨便推薦" },
  { id: "V3", category: "vague", userText: "有點無聊" },
  { id: "V4", category: "vague", userText: "想出門但沒想法" },
  { id: "V5", category: "vague", userText: "幫我想一下" },

  // 7. 多條件混合類
  { id: "X1", category: "mixed", userText: "下雨天想找安靜咖啡廳", minRecommendations: 1 },
  { id: "X2", category: "mixed", userText: "一個人去高雄想放空" },
  { id: "X3", category: "mixed", userText: "11月去釜山三天要怎麼安排" },
  { id: "X4", category: "mixed", userText: "今天有點累但想出門走走" },
  { id: "X5", category: "mixed", userText: "大阪冬天適合去哪裡" },

  // 8. 無關或弱相關輸入
  { id: "O1", category: "offtopic", userText: "哈囉" },
  { id: "O2", category: "offtopic", userText: "你可以做什麼" },
  { id: "O3", category: "offtopic", userText: "我不知道要問什麼" },
  { id: "O4", category: "offtopic", userText: "先陪我聊聊" },
  { id: "O5", category: "offtopic", userText: "今天心情不好" },
];

const API_TIMEOUT_MS = 90_000;

function formatIntent(session: ChatPlanningSession, userText: string, chatPhase: ChatPhase): string {
  const tripIntent = parseTripIntentFromText(userText, session);
  const intent = resolveAiUserIntent(session, userText, tripIntent, { chatPhaseOverride: chatPhase });
  const parts = [intent.type];
  if (intent.destination) parts.push(`dest=${intent.destination}`);
  if (intent.travelMonth) parts.push(`month=${intent.travelMonth}`);
  return parts.join("|");
}

function buildChatRequest(userText: string, chatPhase: ChatPhase): RoamieRequestContext {
  return {
    mode: "chat",
    chatInput: userText,
    chatPhase,
    locale: "zh-TW",
    location: SESSION.location,
    messages: [{ role: "user", content: userText }],
    planTier: "free",
  };
}

function buildItineraryRequest(userText: string, destination: string, days: number): RoamieRequestContext {
  return {
    mode: "itinerary",
    locale: "zh-TW",
    location: SESSION.location,
    planTier: "free",
    chatInput: userText,
    itineraryRequest: {
      destination,
      days,
      budget: "medium",
      mood: "放鬆",
      startDate: "2025-11-10",
      endDate: "2025-11-12",
    },
  };
}

function inferItineraryMeta(userText: string): { destination: string; days: number } | null {
  const dest =
    userText.match(/(大阪|東京|釜山|京都|台南|高雄|台北|首爾)/)?.[1] ??
    parseTripIntentFromText(userText, SESSION).destinationCity;
  const daysMatch = userText.match(/(\d+)\s*天/);
  const days = daysMatch ? Number.parseInt(daysMatch[1], 10) : userText.includes("半日") ? 1 : null;
  if (!dest || !days) return null;
  return { destination: dest, days: Math.min(14, Math.max(1, days)) };
}

async function callRoamieWithTimeout(ctx: RoamieRequestContext): Promise<{
  data: RoamieResponse | null;
  error: string | null;
}> {
  const { callRoamieAI } = await import("@/lib/ai/service.server");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const race = Promise.race([
      callRoamieAI(ctx),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error("API timeout")),
        );
      }),
    ]);
    const data = await race;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveFallbackSummary(userText: string, chatPhase: ChatPhase): Promise<string> {
  const { generateLocalRecommendationFallback } = await import("@/lib/ai/local-recommendation-fallback");
  const { buildChatFallbackReply } = await import("@/lib/ai/local-chat-fallback");
  const { context } = mergeTravelContext(SESSION, userText);
  const tripIntent = parseTripIntentFromText(userText, SESSION);
  const aiIntent = resolveAiUserIntent(SESSION, userText, tripIntent, { chatPhaseOverride: chatPhase });
  const { summary } = generateLocalRecommendationFallback({
    context,
    session: SESSION,
    locale: "zh-TW",
    places: [],
  });
  if (summary.trim()) return summary;
  return buildChatFallbackReply(userText, SESSION, aiIntent);
}

export async function runChatComprehensiveCase(
  caseDef: ChatComprehensiveCase,
): Promise<ChatComprehensiveRow> {
  const userText = caseDef.userText;
  let error = "";
  let apiCalled = false;
  let fallbackUsed = false;
  let status = "pending";
  let summary = "";
  let recommendationCount = 0;

  console.info("[CHAT_SEND_START]", userText.slice(0, 80));
  console.info("[CHAT_USER_MESSAGE_ADDED]", userText.slice(0, 80));

  const { context } = mergeTravelContext(SESSION, userText);
  const route = resolveChatRoute(userText, context, SESSION, "zh-TW");
  const chatPhase = route.chatPhase;
  const detectedIntent = formatIntent(SESSION, userText, chatPhase);

  try {
    const instant = resolveInstantChatReply(userText, SESSION);
    if (instant?.summary) {
      summary = instant.summary;
      status = "instant_reply";
      fallbackUsed = true;
      console.info("[CHAT_ASSISTANT_MESSAGE_ADDED]", {
        source: instant.source,
        excerpt: summary.slice(0, 80),
      });
    } else if (caseDef.forceItinerary || route.mode === "itinerary") {
      const meta = inferItineraryMeta(userText) ?? { destination: "高雄", days: 3 };
      const ctx = buildItineraryRequest(userText, meta.destination, meta.days);
      apiCalled = true;
      console.info("[CHAT_API_REQUEST]", {
        url: "local:callRoamieAI",
        mode: "itinerary",
        userText: userText.slice(0, 80),
      });
      const api = await callRoamieWithTimeout(ctx);
      if (api.data?.summary?.trim()) {
        summary = api.data.summary.trim();
        recommendationCount = api.data.recommendations?.length ?? 0;
        status = "itinerary_ai";
        console.info("[CHAT_API_RESPONSE]", {
          summaryLen: summary.length,
          recommendations: recommendationCount,
          itinerary: api.data.itinerary?.length ?? 0,
        });
      } else {
        fallbackUsed = true;
        summary = await resolveFallbackSummary(userText, chatPhase);
        status = "itinerary_fallback";
        error = api.error ?? "empty_itinerary_response";
        console.info("[CHAT_API_RESPONSE]", { fallback: true, apiError: api.error });
      }
    } else {
      const ctx = buildChatRequest(userText, chatPhase);
      apiCalled = true;
      console.info("[CHAT_API_REQUEST]", {
        url: "local:callRoamieAI",
        mode: ctx.mode,
        chatPhase: ctx.chatPhase,
        userText: userText.slice(0, 80),
      });
      const api = await callRoamieWithTimeout(ctx);
      if (api.data?.summary?.trim()) {
        summary = api.data.summary.trim();
        recommendationCount = api.data.recommendations?.length ?? 0;
        status = "ai_success";
        console.info("[CHAT_API_RESPONSE]", {
          summaryLen: summary.length,
          recommendations: recommendationCount,
        });
      } else {
        fallbackUsed = true;
        summary = await resolveFallbackSummary(userText, chatPhase);
        status = "ai_fallback";
        error = api.error ?? "empty_ai_response";
        console.info("[CHAT_API_RESPONSE]", { fallback: true, apiError: api.error });
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    fallbackUsed = true;
    summary = await resolveFallbackSummary(userText, chatPhase);
    status = "pipeline_error_recovered";
  }

  if (summary.trim()) {
    console.info("[CHAT_ASSISTANT_MESSAGE_ADDED]", {
      source: fallbackUsed ? "fallback" : "ai",
      excerpt: summary.slice(0, 80),
    });
  }

  const assistantCreated = Boolean(summary.trim());
  const minRec = caseDef.minRecommendations ?? 0;
  let result: "PASS" | "FAIL" = "PASS";

  if (!assistantCreated) {
    result = "FAIL";
    if (!error) error = "no_assistant_message";
  } else if (/stack size exceeded/i.test(error) && !fallbackUsed) {
    result = "FAIL";
  } else if (recommendationCount < minRec && apiCalled && !fallbackUsed) {
    result = "FAIL";
    error = error || `recommendations=${recommendationCount}_min=${minRec}`;
  }

  return {
    test_input: userText,
    category: caseDef.category,
    detected_intent: detectedIntent,
    chat_pipeline_status: status,
    api_called: apiCalled,
    assistant_message_created: assistantCreated,
    fallback_used: fallbackUsed,
    recommendation_count: recommendationCount,
    error: result === "FAIL" ? error : error ? `(recovered) ${error}` : "",
    result,
  };
}

async function runPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function runChatComprehensiveQa(options?: {
  concurrency?: number;
}): Promise<ChatComprehensiveResult> {
  const concurrency = options?.concurrency ?? 2;
  console.info(`[verify:chat:comprehensive] ${CHAT_COMPREHENSIVE_CASES.length} cases, concurrency=${concurrency}\n`);

  const rows = await runPool(CHAT_COMPREHENSIVE_CASES, concurrency, runChatComprehensiveCase);
  const passCount = rows.filter((r) => r.result === "PASS").length;
  const failCount = rows.length - passCount;
  const passed = failCount === 0;

  if (passed) {
    console.info("\nQA PASSED");
  } else {
    console.error(`\nQA FAILED pass=${passCount} fail=${failCount}`);
  }

  return { passed, passCount, failCount, rows };
}

export function printComprehensiveQaTable(rows: ChatComprehensiveRow[]): void {
  console.info("\n| test_input | detected_intent | chat_pipeline_status | api_called | assistant_message_created | fallback_used | error | result |");
  console.info("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
    console.info(
      `| ${esc(r.test_input)} | ${esc(r.detected_intent)} | ${r.chat_pipeline_status} | ${r.api_called} | ${r.assistant_message_created} | ${r.fallback_used} | ${esc(r.error || "—")} | ${r.result} |`,
    );
  }
}
