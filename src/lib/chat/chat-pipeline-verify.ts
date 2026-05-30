import type { ChatPlanningSession } from "@/lib/chat-session";
import {
  resolveInstantChatReply,
  userAsksDestinationItineraryAdvice,
} from "@/lib/chat/chat-instant-reply";
import { userAsksTravelTimeAdviceText } from "@/lib/ai/travel-advice-fallback";
import { parseTravelContextFromText } from "@/lib/ai/travel-context";

export type ChatPipelineQaResult = {
  passed: boolean;
  failures: string[];
};

const SESSION: ChatPlanningSession = {
  selectedPlaces: [],
  location: { lat: 22.64, lng: 120.29, city: "高雄" },
} as ChatPlanningSession;

function logInstantPath(text: string, source: string, summary: string) {
  console.info("[CHAT_SEND_START]", text.slice(0, 80));
  console.info("[CHAT_USER_MESSAGE_ADDED]", text.slice(0, 80));
  console.info("[CHAT_ASSISTANT_MESSAGE_ADDED]", {
    source,
    excerpt: summary.slice(0, 80),
  });
}

function logAiPath(text: string, summary: string) {
  console.info("[CHAT_SEND_START]", text.slice(0, 80));
  console.info("[CHAT_USER_MESSAGE_ADDED]", text.slice(0, 80));
  console.info("[CHAT_API_REQUEST]", {
    url: "/api/roamie",
    mode: "chat",
    chatPhase: "recommend",
    userText: text.slice(0, 80),
  });
  console.info("[CHAT_API_RESPONSE]", {
    summaryLen: summary.length,
    recommendations: 0,
    mocked: true,
  });
  console.info("[CHAT_ASSISTANT_MESSAGE_ADDED]", {
    source: "ai_mock",
    excerpt: summary.slice(0, 80),
  });
}

/** 離線 QA：驗 instant reply + 模擬 AI 路徑 log，不依賴 vite-node 載入整包 app */
export function runChatPipelineQa(): ChatPipelineQaResult {
  const failures: string[] = [];

  const caseA = "11月釜山天氣如何";
  const parsedA = parseTravelContextFromText(caseA, SESSION);
  if (parsedA.destination !== "釜山") failures.push("A: destination parse");
  if (!userAsksTravelTimeAdviceText(caseA)) failures.push("A: travel intent");
  const instantA = resolveInstantChatReply(caseA, SESSION);
  if (!instantA?.summary.includes("釜山")) failures.push("A: instant reply");

  const caseB = "11月釜山行程你覺得怎麼安排比較好";
  if (!userAsksDestinationItineraryAdvice(caseB, SESSION)) failures.push("B: itinerary intent");
  const instantB = resolveInstantChatReply(caseB, SESSION);
  if (!instantB?.summary.includes("釜山")) failures.push("B: instant reply");

  const caseC = "我今天有點累";
  if (resolveInstantChatReply(caseC, SESSION) !== null) failures.push("C: should not instant");

  if (failures.length) {
    console.error("[verify:chat] failures:", failures);
    return { passed: false, failures };
  }

  logInstantPath(caseA, instantA!.source, instantA!.summary);
  logInstantPath(caseB, instantB!.source, instantB!.summary);
  logAiPath(caseC, "今天可以慢一點，我先幫你找附近適合休息的地方。");

  console.info("QA PASSED");
  return { passed: true, failures: [] };
}
