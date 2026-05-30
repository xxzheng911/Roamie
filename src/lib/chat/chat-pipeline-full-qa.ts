import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ChatPhase, RoamieRequestContext } from "@/lib/ai/context";
import { parseTravelContextFromText } from "@/lib/ai/travel-context";
import { resolveInstantChatReply } from "@/lib/chat/chat-instant-reply";
import type { RoamieResponse } from "@/lib/ai/types";

export type ChatFullQaCase = {
  id: string;
  label: string;
  userText: string;
  kind: "instant" | "recommend" | "mood" | "itinerary";
  chatPhase?: ChatPhase;
  mood?: string;
  minRecommendations?: number;
  minItineraryDays?: number;
};

export type ChatFullQaCaseResult = {
  id: string;
  label: string;
  userText: string;
  path: "instant" | "ai" | "ai_with_fallback";
  passed: boolean;
  failureReason?: string;
  openAiLikely: boolean;
  fallbackUsed: boolean;
  recommendationCount: number;
  itineraryCount: number;
  summaryExcerpt: string;
  logs: {
    CHAT_SEND_START: boolean;
    CHAT_API_REQUEST: boolean;
    CHAT_API_RESPONSE: boolean;
    CHAT_ASSISTANT_MESSAGE_ADDED: boolean;
  };
};

export type ChatFullQaResult = {
  passed: boolean;
  passCount: number;
  failCount: number;
  failures: string[];
  cases: ChatFullQaCaseResult[];
  aggregateLogs: {
    CHAT_SEND_START: boolean;
    CHAT_API_REQUEST: boolean;
    CHAT_API_RESPONSE: boolean;
    CHAT_ASSISTANT_MESSAGE_ADDED: boolean;
  };
};

const SESSION: ChatPlanningSession = {
  selectedPlaces: [],
  location: { lat: 22.64, lng: 120.29, city: "高雄" },
} as ChatPlanningSession;

const QA_CASES: ChatFullQaCase[] = [
  { id: "A", label: "釜山天氣", userText: "11月釜山天氣如何", kind: "instant" },
  {
    id: "B",
    label: "釜山行程",
    userText: "11月釜山行程你覺得怎麼安排比較好",
    kind: "instant",
  },
  {
    id: "C",
    label: "咖啡廳推薦",
    userText: "想找安靜的咖啡廳",
    kind: "recommend",
    chatPhase: "recommend",
    minRecommendations: 1,
  },
  {
    id: "D",
    label: "下雨天",
    userText: "下雨天可以去哪",
    kind: "recommend",
    chatPhase: "recommend",
    minRecommendations: 0,
  },
  {
    id: "E",
    label: "心情推薦",
    userText: "今天想放空",
    kind: "mood",
    chatPhase: "recommend",
    mood: "想放空",
    minRecommendations: 0,
  },
  {
    id: "F",
    label: "附近景點",
    userText: "附近景點",
    kind: "recommend",
    chatPhase: "recommend",
    minRecommendations: 1,
  },
  {
    id: "G",
    label: "行程生成",
    userText: "幫我排釜山 3 天行程",
    kind: "itinerary",
    minItineraryDays: 1,
  },
];

function buildRoamieRequest(caseDef: ChatFullQaCase): RoamieRequestContext {
  if (caseDef.kind === "itinerary") {
    return {
      mode: "itinerary",
      locale: "zh-TW",
      location: SESSION.location,
      planTier: "free",
      chatInput: caseDef.userText,
      itineraryRequest: {
        destination: "釜山",
        days: 3,
        budget: "medium",
        mood: "放鬆",
        startDate: "2025-11-10",
        endDate: "2025-11-12",
      },
    };
  }

  return {
    mode: "chat",
    chatInput: caseDef.userText,
    chatPhase: caseDef.chatPhase ?? "recommend",
    locale: "zh-TW",
    location: SESSION.location,
    mood: caseDef.mood,
    selectedMood: caseDef.mood,
    messages: [{ role: "user", content: caseDef.userText }],
    planTier: "free",
  };
}

async function callRoamieLocal(caseDef: ChatFullQaCase): Promise<{
  data: RoamieResponse | null;
  error: string | null;
}> {
  const { callRoamieAI } = await import("@/lib/ai/service.server");
  const ctx = buildRoamieRequest(caseDef);
  console.info("[CHAT_API_REQUEST]", {
    url: "local:callRoamieAI",
    mode: ctx.mode,
    chatPhase: ctx.chatPhase,
    userText: caseDef.userText.slice(0, 80),
  });

  try {
    const data = await callRoamieAI(ctx);
    console.info("[CHAT_API_RESPONSE]", {
      summaryLen: data.summary?.length ?? 0,
      recommendations: data.recommendations?.length ?? 0,
      itinerary: data.itinerary?.length ?? 0,
    });
    return { data, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[CHAT_API_ERROR]", { error: msg });
    return { data: null, error: msg };
  }
}

async function resolveFallbackSummary(userText: string): Promise<string> {
  const { mergeTravelContext } = await import("@/lib/ai/travel-context");
  const { generateLocalRecommendationFallback } = await import("@/lib/ai/local-recommendation-fallback");
  const { parseTripIntentFromText } = await import("@/lib/recommendation/trip-intent");
  const { resolveAiUserIntent } = await import("@/lib/ai/user-intent");
  const { buildChatFallbackReply } = await import("@/lib/ai/local-chat-fallback");

  const { context } = mergeTravelContext(SESSION, userText);
  const { summary: localSummary } = generateLocalRecommendationFallback({
    context,
    session: SESSION,
    locale: "zh-TW",
    places: [],
  });
  if (localSummary.trim()) return localSummary;

  const tripIntent = parseTripIntentFromText(userText, SESSION);
  const aiIntent = resolveAiUserIntent(SESSION, userText, tripIntent, { chatPhaseOverride: "recommend" });
  return buildChatFallbackReply(userText, SESSION, aiIntent);
}

function validateCase(caseDef: ChatFullQaCase, data: RoamieResponse | null, error: string | null): string | null {
  if (error) {
    if (/stack size exceeded/i.test(error)) return "stack_overflow";
    return error.slice(0, 120);
  }
  if (!data?.summary?.trim()) return "empty_summary";

  if (caseDef.kind === "itinerary") {
    const days = new Set((data.itinerary ?? []).map((i) => i.date).filter(Boolean));
    if ((caseDef.minItineraryDays ?? 1) > days.size && (data.itinerary?.length ?? 0) < 3) {
      return `itinerary_too_short=${data.itinerary?.length ?? 0}`;
    }
    return null;
  }

  const minRec = caseDef.minRecommendations ?? 0;
  const recCount = data.recommendations?.length ?? 0;
  if (recCount < minRec) return `recommendations=${recCount}_min=${minRec}`;
  return null;
}

async function simulateSend(caseDef: ChatFullQaCase): Promise<ChatFullQaCaseResult> {
  const { userText } = caseDef;
  const logs = {
    CHAT_SEND_START: false,
    CHAT_API_REQUEST: false,
    CHAT_API_RESPONSE: false,
    CHAT_ASSISTANT_MESSAGE_ADDED: false,
  };

  console.info("\n--- QA case", caseDef.id, caseDef.label, "---");
  console.info("[CHAT_SEND_START]", userText.slice(0, 80));
  logs.CHAT_SEND_START = true;
  console.info("[CHAT_USER_MESSAGE_ADDED]", userText.slice(0, 80));

  if (caseDef.kind === "instant") {
    const instant = resolveInstantChatReply(userText, SESSION);
    if (!instant?.summary) {
      return {
        id: caseDef.id,
        label: caseDef.label,
        userText,
        path: "instant",
        passed: false,
        failureReason: "missing_instant_reply",
        openAiLikely: "n/a" as const,
        fallbackUsed: false,
        recommendationCount: 0,
        itineraryCount: 0,
        summaryExcerpt: "",
        logs,
      };
    }
    console.info("[CHAT_ASSISTANT_MESSAGE_ADDED]", {
      source: instant.source,
      excerpt: instant.summary.slice(0, 80),
    });
    logs.CHAT_ASSISTANT_MESSAGE_ADDED = true;
    return {
      id: caseDef.id,
      label: caseDef.label,
      userText,
      path: "instant",
      passed: true,
      openAiLikely: "n/a",
      fallbackUsed: true,
      recommendationCount: 0,
      itineraryCount: 0,
      summaryExcerpt: instant.summary.slice(0, 120),
      logs,
    };
  }

  const api = await callRoamieLocal(caseDef);
  logs.CHAT_API_REQUEST = true;
  logs.CHAT_API_RESPONSE = Boolean(api.data || api.error);

  let summary = api.data?.summary?.trim() ?? "";
  let fallbackUsed = false;
  if (!summary) {
    fallbackUsed = true;
    summary = await resolveFallbackSummary(userText);
    console.info("[CHAT_API_RESPONSE]", {
      summaryLen: summary.length,
      recommendations: 0,
      fallback: true,
      apiError: api.error,
    });
  }

  const validationError = validateCase(caseDef, api.data, api.error);
  const passed = Boolean(summary) && !validationError;

  console.info("[CHAT_ASSISTANT_MESSAGE_ADDED]", {
    source: fallbackUsed ? "local_recommendation" : "ai_api",
    excerpt: summary.slice(0, 80),
  });
  logs.CHAT_ASSISTANT_MESSAGE_ADDED = true;

  return {
    id: caseDef.id,
    label: caseDef.label,
    userText,
    path: fallbackUsed ? "ai_with_fallback" : "ai",
    passed,
    failureReason: validationError ?? undefined,
    openAiLikely: Boolean(api.data && !api.error),
    fallbackUsed,
    recommendationCount: api.data?.recommendations?.length ?? 0,
    itineraryCount: api.data?.itinerary?.length ?? 0,
    summaryExcerpt: summary.slice(0, 120),
    logs,
  };
}

export async function runChatPipelineFullQa(): Promise<ChatFullQaResult> {
  const failures: string[] = [];
  const cases: ChatFullQaCaseResult[] = [];

  for (const caseDef of QA_CASES) {
    const result = await simulateSend(caseDef);
    cases.push(result);

    if (!result.logs.CHAT_SEND_START) failures.push(`${caseDef.id}: missing CHAT_SEND_START`);
    if (!result.logs.CHAT_ASSISTANT_MESSAGE_ADDED) {
      failures.push(`${caseDef.id}: missing CHAT_ASSISTANT_MESSAGE_ADDED`);
    }
    if (caseDef.kind !== "instant") {
      if (!result.logs.CHAT_API_REQUEST) failures.push(`${caseDef.id}: missing CHAT_API_REQUEST`);
      if (!result.logs.CHAT_API_RESPONSE) failures.push(`${caseDef.id}: missing CHAT_API_RESPONSE`);
    }
    if (!result.passed) {
      failures.push(`${caseDef.id}(${caseDef.label}): ${result.failureReason ?? "failed"}`);
    }
  }

  const aggregateLogs = {
    CHAT_SEND_START: cases.every((c) => c.logs.CHAT_SEND_START),
    CHAT_API_REQUEST: cases.some((c) => c.logs.CHAT_API_REQUEST),
    CHAT_API_RESPONSE: cases.some((c) => c.logs.CHAT_API_RESPONSE),
    CHAT_ASSISTANT_MESSAGE_ADDED: cases.every((c) => c.logs.CHAT_ASSISTANT_MESSAGE_ADDED),
  };

  const passCount = cases.filter((c) => c.passed).length;
  const failCount = cases.length - passCount;
  const passed = failures.length === 0;

  if (passed) {
    console.info("\nQA PASSED");
  } else {
    console.error("\n[verify:chat:full] failures:", failures);
  }

  return { passed, passCount, failCount, failures, cases, aggregateLogs };
}
