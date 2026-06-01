/**
 * P0 Plus personalization — prompt wiring & differentiation QA.
 * Run: npm run verify:plus-personalization
 */
import { buildSystemPrompt } from "@/lib/ai/prompts";
import type { RoamieRequestContext } from "@/lib/ai/context";
import { parseRoamieRequest } from "@/lib/ai/service.server";
import { applyTierToAiContext } from "@/lib/access/context";
import { buildHomePlusInsight } from "@/lib/home-personalization-insight";
import {
  buildPlusMemoryFromSources,
  mergePlusMemoryIntoSnapshot,
  parsePlusMemory,
} from "@/lib/ai/plus-memory-sync";
import { formatLongTermMemoryForPrompt } from "@/lib/ai/memory/long-term-memory";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { LongTermMemorySnapshot } from "@/lib/ai/memory/types";

export type PlusPersonalizationVerifyResult = {
  passed: boolean;
  failures: string[];
  promptDiffScore: number;
  userAPromptExcerpt: string;
  userBPromptExcerpt: string;
  liveAiSkipped: boolean;
  liveAiPassed?: boolean;
};

const OSAKA_QUERY = "幫我規劃大阪五天行程，給我具體推薦";

function userAPrefs(): TravelPreferences {
  return {
    pace: "slow",
    vibe: "quiet",
    budgetMode: "comfortable",
    avoid: ["人擠人"],
    interests: ["咖啡廳", "老宅咖啡", "慢旅行", "巷弄散步"],
    onboarded: true,
    surveyCompleted: true,
    personalityType: "慢步調探索者",
    personalitySummary: "喜歡在老宅咖啡廳留一整個下午，不趕行程。",
    resultProfile: {
      personalityType: "慢步調探索者",
      travelStyle: "慢旅行",
      travelTags: ["老宅咖啡", "巷弄", "留白"],
      personalitySummary: "喜歡在老宅咖啡廳留一整個下午，不趨行程。",
    },
  };
}

function userBPrefs(): TravelPreferences {
  return {
    pace: "active",
    vibe: "lively",
    budgetMode: "comfortable",
    avoid: [],
    interests: ["購物", "夜生活", "百貨", "酒吧"],
    onboarded: true,
    surveyCompleted: true,
    personalityType: "城市夜行者",
    personalitySummary: "喜歡逛街血拼，晚上找酒吧或夜景。",
    resultProfile: {
      personalityType: "城市夜行者",
      travelStyle: "都會探索",
      travelTags: ["購物", "夜生活", "百貨"],
      personalitySummary: "喜歡逛街血拼，晚上找酒吧或夜景。",
    },
  };
}

function longTermForUser(
  prefs: TravelPreferences,
  savedCategories: string[],
): LongTermMemorySnapshot {
  const plusMemory = buildPlusMemoryFromSources({
    prefs,
    savedCategories,
    existing: null,
  });
  const base: LongTermMemorySnapshot = {
    personalityType: prefs.personalityType,
    personalitySummary: prefs.personalitySummary,
    interests: prefs.interests,
    pace: prefs.pace === "slow" ? "慢旅、留白多" : "節奏偏緊、想多看",
    savedPlaceCategories: savedCategories,
    traits: prefs.interests,
  };
  return mergePlusMemoryIntoSnapshot(base, plusMemory);
}

function buildPlusChatContext(
  prefs: TravelPreferences,
  savedNames: string[],
  savedCategories: string[],
): RoamieRequestContext {
  return {
    mode: "chat",
    planTier: "plus",
    locale: "zh-TW",
    chatInput: OSAKA_QUERY,
    chatPhase: "recommend",
    conversationStage: "recommend",
    preferences: prefs,
    savedPlaceNames: savedNames,
    longTermMemory: longTermForUser(prefs, savedCategories),
    location: { lat: 34.6937, lng: 135.5023, city: "大阪" },
    time: new Date().toISOString(),
  };
}

function promptKeywordHits(prompt: string, keywords: string[]): number {
  return keywords.filter((k) => prompt.includes(k)).length;
}

function assertPlusMemoryPersistsMerge(): string | null {
  const first = buildPlusMemoryFromSources({
    prefs: userAPrefs(),
    savedCategories: ["咖啡廳"],
    existing: { likes: ["手沖咖啡"] },
  });
  const second = buildPlusMemoryFromSources({
    prefs: userAPrefs(),
    savedCategories: ["咖啡廳", "甜點"],
    existing: first,
  });
  if (!second.likes?.includes("手沖咖啡")) return "plus_memory: existing likes not preserved";
  if (!second.savedPlacePatterns?.includes("甜點")) return "plus_memory: saved categories not merged";
  const roundtrip = parsePlusMemory(JSON.parse(JSON.stringify(second)));
  if (!roundtrip.likes?.length) return "plus_memory: JSON roundtrip failed";
  return null;
}

function assertApiSchemaRoundtrip(): string | null {
  const mem = longTermForUser(userAPrefs(), ["咖啡廳"]);
  const body = {
    mode: "chat",
    planTier: "plus",
    chatInput: "test",
    longTermMemory: mem,
    preferences: userAPrefs(),
  };
  const parsed = parseRoamieRequest(body);
  if (!parsed.longTermMemory?.traits?.length) {
    return "API schema: longTermMemory stripped on parse";
  }
  return null;
}

function assertFreeStripsPlusContext(): string | null {
  const ctx = buildPlusChatContext(userAPrefs(), ["% Arabica 京都"], ["咖啡廳"]);
  const free = applyTierToAiContext(ctx, "free");
  if (free.longTermMemory) return "Free tier: longTermMemory should be stripped";
  if (free.savedPlaceNames?.length) return "Free tier: savedPlaceNames should be stripped";
  const prompt = buildSystemPrompt(free);
  if (prompt.includes("【Travel Profile")) return "Free tier: Travel Profile block leaked";
  if (prompt.includes("【長期記憶（Plus）】")) return "Free tier: long-term memory block leaked";
  return null;
}

export function runPlusPersonalizationVerify(): PlusPersonalizationVerifyResult {
  const failures: string[] = [];

  const ctxA = buildPlusChatContext(
    userAPrefs(),
    ["% Arabica 京都", "惠美須通老宅咖啡"],
    ["咖啡廳", "老宅"],
  );
  const ctxB = buildPlusChatContext(
    userBPrefs(),
    ["心齋橋", "道頓堀夜景酒吧"],
    ["購物", "酒吧", "夜景"],
  );

  const promptA = buildSystemPrompt(ctxA);
  const promptB = buildSystemPrompt(ctxB);

  if (!promptA.includes("Travel Profile")) failures.push("User A: Travel Profile block missing");
  if (!promptB.includes("Travel Profile")) failures.push("User B: Travel Profile block missing");

  const longTermA = formatLongTermMemoryForPrompt(ctxA.longTermMemory!);
  const longTermB = formatLongTermMemoryForPrompt(ctxB.longTermMemory!);
  if (!longTermA.includes("咖啡")) failures.push("User A: long-term memory missing 咖啡");
  if (!longTermB.includes("購物") && !longTermB.includes("夜")) {
    failures.push("User B: long-term memory missing 購物/夜生活");
  }

  if (!promptA.includes("收藏地點")) failures.push("User A: saved places not in prompt");
  if (!promptB.includes("收藏地點")) failures.push("User B: saved places not in prompt");

  const aHits = promptKeywordHits(promptA, ["咖啡", "慢", "巷弄", "老宅", "留白"]);
  const bHits = promptKeywordHits(promptB, ["購物", "夜生活", "百貨", "酒吧", "夜景"]);
  const promptDiffScore = aHits + bHits;

  if (aHits < 2) failures.push(`User A: insufficient preference keywords in prompt (${aHits})`);
  if (bHits < 2) failures.push(`User B: insufficient preference keywords in prompt (${bHits})`);

  if (!promptA.includes("慢步調探索者")) failures.push("User A: Travel Profile missing 慢步調探索者");
  if (!promptB.includes("城市夜行者")) failures.push("User B: Travel Profile missing 城市夜行者");
  if (promptA.includes("城市夜行者")) failures.push("User A: leaked User B personality");
  if (promptB.includes("慢步調探索者")) failures.push("User B: leaked User A personality");

  const insightA = buildHomePlusInsight({
    savedPlaces: [
      {
        id: "1",
        name: "老宅咖啡",
        category: "咖啡廳",
        address: null,
        city: null,
        lat: 0,
        lng: 0,
        notes: null,
        mood_tag: null,
        cover_image: null,
        image_url: null,
        image_source: null,
        metadata: {},
        created_at: new Date().toISOString(),
      },
    ],
    prefs: userAPrefs(),
  });
  const insightB = buildHomePlusInsight({
    savedPlaces: [
      {
        id: "2",
        name: "心齋橋",
        category: "購物",
        address: null,
        city: null,
        lat: 0,
        lng: 0,
        notes: null,
        mood_tag: null,
        cover_image: null,
        image_url: null,
        image_source: null,
        metadata: {},
        created_at: new Date().toISOString(),
      },
    ],
    prefs: userBPrefs(),
  });
  if (!insightA.includes("慢步調探索者") && !insightA.includes("咖啡")) {
    failures.push("Home insight A: missing personality or saved category");
  }
  if (!insightB.includes("城市夜行者") && !insightB.includes("購物")) {
    failures.push("Home insight B: missing personality or saved category");
  }

  for (const check of [
    assertPlusMemoryPersistsMerge,
    assertApiSchemaRoundtrip,
    assertFreeStripsPlusContext,
  ]) {
    const err = check();
    if (err) failures.push(err);
  }

  const result: PlusPersonalizationVerifyResult = {
    passed: failures.length === 0,
    failures,
    promptDiffScore,
    userAPromptExcerpt: promptA.slice(0, 500),
    userBPromptExcerpt: promptB.slice(0, 500),
    liveAiSkipped: true,
  };

  if (failures.length) {
    console.error("[verify:plus-personalization] failures:", failures);
  } else {
    console.info("[verify:plus-personalization] prompt wiring QA PASSED", {
      promptDiffScore,
      insightA: insightA.slice(0, 80),
      insightB: insightB.slice(0, 80),
    });
  }

  return result;
}

/** Optional live OpenAI diff — requires OPENAI_API_KEY */
export async function runLiveAiPersonalizationDiff(): Promise<{
  passed: boolean;
  userASummary: string;
  userBSummary: string;
  reason?: string;
}> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return { passed: false, userASummary: "", userBSummary: "", reason: "OPENAI_API_KEY not set" };
  }

  const { callRoamieAI } = await import("@/lib/ai/service.server");

  const ctxA = buildPlusChatContext(userAPrefs(), [], ["咖啡廳"]);
  const ctxB = buildPlusChatContext(userBPrefs(), [], ["購物", "酒吧"]);

  const [resA, resB] = await Promise.all([callRoamieAI(ctxA), callRoamieAI(ctxB)]);

  const textA = `${resA.summary} ${resA.recommendations?.map((r) => `${r.name} ${r.reason}`).join(" ") ?? ""}`;
  const textB = `${resB.summary} ${resB.recommendations?.map((r) => `${r.name} ${r.reason}`).join(" ") ?? ""}`;

  const aSignal = /咖啡|巷弄|慢|老宅|甜點/.test(textA);
  const bSignal = /購物|心齋橋|道頓堀|夜|酒吧|百貨|血拼/.test(textB);
  const crossLeak = /咖啡廳|慢旅行/.test(textB) && /酒吧|購物/.test(textA);

  const passed = aSignal && bSignal && textA !== textB && !crossLeak;

  return {
    passed,
    userASummary: textA.slice(0, 400),
    userBSummary: textB.slice(0, 400),
    reason: passed
      ? undefined
      : `aSignal=${aSignal} bSignal=${bSignal} same=${textA === textB} crossLeak=${crossLeak}`,
  };
}

export async function runPlusPersonalizationVerifyFull(): Promise<PlusPersonalizationVerifyResult> {
  const base = runPlusPersonalizationVerify();
  if (!base.passed) return base;

  const live = await runLiveAiPersonalizationDiff();
  base.liveAiSkipped = live.reason === "OPENAI_API_KEY not set";
  if (!base.liveAiSkipped) {
    base.liveAiPassed = live.passed;
    if (!live.passed) {
      base.passed = false;
      base.failures.push(`Live AI diff failed: ${live.reason}`);
      console.error("[verify:plus-personalization] live AI", live);
    } else {
      console.info("[verify:plus-personalization] live AI PASSED", {
        userA: live.userASummary.slice(0, 120),
        userB: live.userBSummary.slice(0, 120),
      });
    }
  } else {
    console.info("[verify:plus-personalization] live AI skipped (set OPENAI_API_KEY for E2E)");
  }
  return base;
}
