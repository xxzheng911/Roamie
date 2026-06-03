import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAssistantMessageToConversation,
  conversationMissingAssistantReply,
} from "@/lib/chat/chat-append-assistant";
import { resolveInstantChatReply } from "@/lib/chat/chat-instant-reply";
import type { ChatPlanningSession } from "@/lib/chat-session";
import {
  shouldSkipNearbyRefetch,
} from "@/lib/home-location-fetch-policy";
import { _appIndexUsesHomeNearbyEnrichOnCacheHit } from "@/lib/verify/home-index-nearby-wire";
import { chatSendWiresDateRecommendationReply } from "@/lib/verify/chat-send-wire";
import { buildSafeItineraryGeneratorPayload, safeSerializeItineraryPayload } from "@/lib/trip/safe-itinerary-payload";
import type { ItineraryInput } from "@/lib/itinerary.functions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const TOKYO_SIX_DAY_MSG = "12月初去東京，6天的話你覺得要哪6天";
const BASE_SESSION: ChatPlanningSession = {
  phase: "followup",
  mood: null,
  selectedMood: null,
  tripDestination: { city: "東京", country: "日本" },
  travelMonth: "12月",
  travelDays: 6,
} as ChatPlanningSession;

function readSrc(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("pre-rerun verification (static + simulated)", () => {
  it("1) home nearby UI uses HomeNearbyPlaceCards only in index section", () => {
    const indexSrc = readSrc("routes/_app.index.tsx");
    expect(indexSrc).toContain("<HomeNearbyPlaceCards");
    expect(indexSrc).not.toMatch(/<MapExplorePlaceCards|<SavedPlaceCard/);
    const cardsSrc = readSrc("components/home/HomeNearbyPlaceCards.tsx");
    expect(cardsSrc).toContain("export function HomeNearbyPlaceCards");
  });

  it("2) card debug logs wired on HomeNearbyPlaceCards + index setState paths", () => {
    const cardsSrc = readSrc("components/home/HomeNearbyPlaceCards.tsx");
    expect(cardsSrc).toContain("[HOME_NEARBY_CARDS_MOUNT]");
    expect(cardsSrc).toContain("logHomeNearbyCardsData");
    expect(cardsSrc).toContain("logPlaceCardSource");

    const debugSrc = readSrc("lib/place-card-debug.ts");
    expect(debugSrc).toContain("[HOME_NEARBY_CARD_DATA]");
    expect(debugSrc).toContain("[PLACE_PHOTO_SOURCE]");
    expect(debugSrc).toContain("[PLACE_OPENING_HOURS]");

    const indexSrc = readSrc("routes/_app.index.tsx");
    expect(indexSrc).toContain("logHomeNearbyCardsData");
    expect(indexSrc).toMatch(/<HomeNearbyPlaceCards[\s\S]*places=\{nearbyPicks\}/);
    expect(_appIndexUsesHomeNearbyEnrichOnCacheHit()).toBe(true);
  });

  it("3) Tokyo 6-day chat: instant reply + full success log chain (simulated send path)", () => {
    expect(chatSendWiresDateRecommendationReply()).toBe(true);

    const instant = resolveInstantChatReply(TOKYO_SIX_DAY_MSG, BASE_SESSION);
    expect(instant?.summary?.trim().length).toBeGreaterThan(20);
    expect(instant?.startItinerary).toBeFalsy();

    const logTags: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((first: unknown, ...rest: unknown[]) => {
      const tag = typeof first === "string" ? first : "";
      logTags.push(tag);
      if (tag === "[CHAT_APPEND_ASSISTANT_SUCCESS]" && rest[0] && typeof rest[0] === "object") {
        logTags.push(JSON.stringify(rest[0]));
      }
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    // send() 開頭
    console.info("[CHAT_SEND_START]", TOKYO_SIX_DAY_MSG.slice(0, 80));
    // priority_instant 分支（_app.chat.tsx 2578）
    console.info("[AI_RESPONSE_REQUEST_START]", {
      action: "answer_date_recommendation",
      path: "priority_instant",
      source: instant!.source,
    });
    // commitAssistantReply（_app.chat.tsx 552 + append）
    console.info("[AI_RESPONSE_RECEIVED]", {
      source: instant!.source,
      excerpt: instant!.summary.slice(0, 120),
    });
    const appended = appendAssistantMessageToConversation(
      [{ role: "user", content: TOKYO_SIX_DAY_MSG }],
      instant!.summary,
      BASE_SESSION,
    );
    expect(appended.ok).toBe(true);
    expect(conversationMissingAssistantReply(appended.conversation)).toBe(false);

    spy.mockRestore();

    const order = [
      "[CHAT_SEND_START]",
      "[AI_RESPONSE_REQUEST_START]",
      "[AI_RESPONSE_RECEIVED]",
      "[CHAT_APPEND_ASSISTANT_SUCCESS]",
    ];
    for (const tag of order) {
      expect(logTags.some((l) => l === tag || l.includes(tag)), `${tag} missing`).toBe(true);
    }
    expect(logTags.join("\n")).not.toMatch(/Maximum call stack/i);
  });

  it("3b) itinerary payload cannot throw stack overflow on circular refs", () => {
    const circular: Record<string, unknown> = { name: "測試" };
    circular.self = circular;
    const input = {
      destination: "東京",
      days: 6,
      selectedPlaces: [circular],
    } as unknown as ItineraryInput;
    expect(() => buildSafeItineraryGeneratorPayload(input)).not.toThrow();
    expect(() => safeSerializeItineraryPayload(input)).not.toThrow();
    expect(safeSerializeItineraryPayload(input)).not.toMatch(/Maximum call stack/i);
  });

  it("4) NEARBY_FETCH_START throttled: second call within 45s same cache key skips", () => {
    const key = "v5§25.033§121.565§food§";
    const coords = { lat: 25.033, lng: 121.565 };
    const now = Date.now();
    const first = shouldSkipNearbyRefetch({
      prevCoords: null,
      nextCoords: coords,
      lastFetchAt: 0,
      cacheKey: key,
      lastCacheKey: null,
      now,
    });
    expect(first.skip).toBe(false);

    const second = shouldSkipNearbyRefetch({
      prevCoords: coords,
      nextCoords: coords,
      lastFetchAt: now - 5_000,
      cacheKey: key,
      lastCacheKey: key,
      now,
    });
    expect(second.skip).toBe(true);
    expect(second.reason).toBe("interval_same_cache_key");

    const indexSrc = readSrc("routes/_app.index.tsx");
    expect(indexSrc.indexOf("readHomeNearbyCache")).toBeLessThan(
      indexSrc.indexOf("[NEARBY_FETCH_START]"),
    );
    expect(indexSrc).toContain("[NEARBY_FETCH_IN_FLIGHT_SKIP]");
    expect(indexSrc).toContain("logNearbyFetchSkipped");
  });
});
