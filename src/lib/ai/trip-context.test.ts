import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { resolveInstantChatReply } from "@/lib/chat/chat-instant-reply";
import {
  appendAssistantMessageToConversation,
  conversationMissingAssistantReply,
} from "@/lib/chat/chat-append-assistant";
import {
  buildDateRangeRecommendationReply,
  decideAiNextStep,
  extractTripContextSlice,
  isTripContextComplete,
  logAiNextStepDecision,
  userAsksDateRangeRecommendation,
  hasCoreTripPlanningContext,
} from "@/lib/ai/trip-context-completeness";
import { parseMustIncludePlaces } from "@/lib/ai/must-include-places";
import { userRequestsFullItineraryPlanning } from "@/lib/ai/itinerary-trigger";
import {
  buildStructuredChatItinerary,
  countMustPlacesInItinerary,
} from "@/lib/ai/structured-chat-itinerary";
import {
  resolveHomeNearbyHoursDisplay,
  resolveHomeNearbyImageSource,
} from "@/lib/home-nearby-card-display";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { enrichHomeNearbyPicks } from "@/lib/enrich-home-nearby-picks";
import { HOME_NEARBY_CACHE_VERSION } from "@/lib/home-nearby-enrich";
import {
  buildSafeItineraryGeneratorPayload,
  safeSerializeItineraryPayload,
} from "@/lib/trip/safe-itinerary-payload";
import type { ItineraryInput } from "@/lib/itinerary.functions";
import { chatSendWiresDateRecommendationReply } from "@/lib/verify/chat-send-wire";
import { _appIndexUsesHomeNearbyEnrichOnCacheHit } from "@/lib/verify/home-index-nearby-wire";

const TOKYO_SIX_DAY_MSG = "12月初去東京，6天的話你覺得要哪6天";

const TOKYO_PLAN_WITH_MUST_MSG =
  "我預計12月中要去東京，應該去6天（機票早去晚回）行程要有去富士山跟哈利波特影城，請幫我安排";

const BASE_SESSION = {
  selectedPlaces: [],
  conversationState: { preferences: [], stage: "gathering" as const },
} as ChatPlanningSession;

describe("trip-context", () => {
  it("parses 東京 / 12月 / 6天 from user message", () => {
    const slice = extractTripContextSlice(BASE_SESSION, TOKYO_SIX_DAY_MSG);
    expect(slice.destination).toBe("東京");
    expect(slice.travelMonth).toBe("12月");
    expect(slice.days).toBe(6);
    expect(isTripContextComplete(slice)).toBe(true);
  });

  it("decides answer_date_recommendation (not ask days/destination)", () => {
    expect(userAsksDateRangeRecommendation(TOKYO_SIX_DAY_MSG)).toBe(true);
    const decision = decideAiNextStep(BASE_SESSION, TOKYO_SIX_DAY_MSG);
    expect(decision.action).toBe("answer_date_recommendation");
    expect(decision.reason).toBe("complete_context_date_question");
  });

  it("parses mustIncludePlaces from planning message", () => {
    expect(parseMustIncludePlaces(TOKYO_PLAN_WITH_MUST_MSG)).toEqual([
      "富士山",
      "哈利波特影城",
    ]);
  });

  it("decides generate_itinerary for explicit 6-day Tokyo plan with must-include", () => {
    expect(userRequestsFullItineraryPlanning(TOKYO_PLAN_WITH_MUST_MSG)).toBe(true);
    const slice = extractTripContextSlice(BASE_SESSION, TOKYO_PLAN_WITH_MUST_MSG);
    expect(slice.destination).toBe("東京");
    expect(slice.days).toBe(6);
    expect(slice.travelMonth).toBe("12月中");
    expect(hasCoreTripPlanningContext(slice)).toBe(true);
    const decision = decideAiNextStep(BASE_SESSION, TOKYO_PLAN_WITH_MUST_MSG);
    expect(decision.action).toBe("generate_itinerary");
    expect(decision.reason).toBe("explicit_plan_request_with_destination_and_days");
  });

  it("resolveInstantChatReply returns null for full itinerary plan (no generic chat)", () => {
    const instant = resolveInstantChatReply(TOKYO_PLAN_WITH_MUST_MSG, BASE_SESSION);
    expect(instant).toBeNull();
  });

  it("structured itinerary includes Fuji and Harry Potter over 6 days", () => {
    const payload = buildStructuredChatItinerary({
      destination: "東京",
      days: 6,
      startDate: "2025-12-02",
      endDate: "2025-12-07",
      mustIncludePlaces: ["富士山", "哈利波特影城"],
    });
    expect(payload.dayPlans?.length).toBe(6);
    const included = countMustPlacesInItinerary(
      payload.itinerary ?? [],
      ["富士山", "哈利波特影城"],
    );
    expect(included).toContain("富士山");
    expect(included).toContain("哈利波特影城");
  });

  it("resolveInstantChatReply returns Tokyo 6-day date recommendation", () => {
    const instant = resolveInstantChatReply(TOKYO_SIX_DAY_MSG, BASE_SESSION);
    expect(instant).not.toBeNull();
    expect(instant!.startItinerary).toBeFalsy();
    expect(instant!.summary).toMatch(/東京/);
    expect(instant!.summary).toMatch(/12\/2～12\/7|12\/3～12\/8/);
    expect(instant!.summary).not.toMatch(/待幾天/);
    expect(instant!.summary).not.toMatch(/你想去哪/);
  });

  it("buildDateRangeRecommendationReply matches 6-day December Tokyo copy", () => {
    const reply = buildDateRangeRecommendationReply({
      destination: "東京",
      travelMonth: "12月",
      days: 6,
    });
    expect(reply).toContain("12/2～12/7");
    expect(reply).toContain("12/3～12/8");
  });

  it("append assistant after user turn (simulated send pipeline)", () => {
    const instant = resolveInstantChatReply(TOKYO_SIX_DAY_MSG, BASE_SESSION);
    expect(instant?.summary?.trim()).toBeTruthy();

    const userConv = [{ role: "user" as const, content: TOKYO_SIX_DAY_MSG }];
    expect(conversationMissingAssistantReply(userConv)).toBe(true);

    const { conversation, ok } = appendAssistantMessageToConversation(
      userConv,
      instant!.summary,
      BASE_SESSION,
    );
    expect(ok).toBe(true);
    expect(conversation.at(-1)?.role).toBe("assistant");
    expect(conversationMissingAssistantReply(conversation)).toBe(false);
    const text =
      conversation.at(-1)?.content?.trim() ||
      conversation.at(-1)?.roamie?.summary?.trim() ||
      "";
    expect(text.length).toBeGreaterThan(20);
  });

  it("send() in _app.chat.tsx wires priority_instant + date fallback + safe itinerary", () => {
    expect(chatSendWiresDateRecommendationReply()).toBe(true);
  });

  it("emits [AI_NEXT_STEP_DECISION] and append logs", () => {
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });

    logAiNextStepDecision(BASE_SESSION, TOKYO_SIX_DAY_MSG);
    const instant = resolveInstantChatReply(TOKYO_SIX_DAY_MSG, BASE_SESSION);
    appendAssistantMessageToConversation(
      [{ role: "user", content: TOKYO_SIX_DAY_MSG }],
      instant!.summary,
      BASE_SESSION,
    );

    const flat = logs.map((a) => JSON.stringify(a)).join("\n");
    expect(flat).toContain("[AI_NEXT_STEP_DECISION]");
    expect(flat).toContain("answer_date_recommendation");
    expect(flat).toContain("[AI_RESPONSE_TEXT_READY]");
    expect(flat).toContain("[CHAT_APPEND_ASSISTANT_START]");
    expect(flat).toContain("[CHAT_APPEND_ASSISTANT_SUCCESS]");
    expect(flat).toMatch(/lastMessageRole.*assistant/);

    spy.mockRestore();
  });

  it("safe itinerary payload serializes without stack overflow", () => {
    const circular: Record<string, unknown> = { name: "測試" };
    circular.self = circular;
    const input = {
      destination: "東京",
      days: 6,
      selectedPlaces: [circular],
    } as unknown as ItineraryInput;

    expect(() => buildSafeItineraryGeneratorPayload(input)).not.toThrow();
    expect(() => safeSerializeItineraryPayload(input)).not.toThrow();
    const json = safeSerializeItineraryPayload(input);
    expect(json).toContain("東京");
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe("trip-context home nearby cards", () => {
  it("cache version bumped so stale picks are invalidated", () => {
    expect(HOME_NEARBY_CACHE_VERSION).toBe("v5");
  });

  it("index nearby fetch has throttle + cache hit guards (wire check)", () => {
    expect(_appIndexUsesHomeNearbyEnrichOnCacheHit()).toBe(true);
  });

  it("imageSource: photoName beats coverImageUrl", () => {
    expect(
      resolveHomeNearbyImageSource({
        photoName: "places/ChIJxxx/photos/abc",
        coverImageUrl: "https://images.unsplash.com/fallback",
      }),
    ).toBe("google");
    expect(
      resolveHomeNearbyImageSource({
        photoName: null,
        photoNames: ["places/ChIJxxx/photos/abc"],
        coverImageUrl: "https://images.unsplash.com/fallback",
      }),
    ).toBe("google");
    expect(
      resolveHomeNearbyImageSource({
        photoName: null,
        coverImageUrl: "https://images.unsplash.com/photo-1",
      }),
    ).toBe("maps_proxy_or_unsplash");
    expect(resolveHomeNearbyImageSource({ photoName: null, coverImageUrl: null })).toBe(
      "fallback",
    );
  });

  it("hours: with hoursData does not show 暫時無法確認營業時間", () => {
    const pick: HomeNearbyPick = {
      id: "ChIJ_test",
      name: "興合米行",
      address: null,
      lat: 25.0,
      lng: 121.5,
      rating: 4.5,
      userRatingCount: 10,
      photoName: "places/ChIJ_test/photos/p1",
      primaryType: "grocery_store",
      businessStatus: "OPERATIONAL",
      openStatus: "unknown",
      openStatusLabel: "",
      todayHoursLabel: "",
      closesAtLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
      reason: "附近",
      categoryId: "food",
      hoursData: {
        businessStatus: "OPERATIONAL",
        currentOpeningHours: { openNow: true, weekdayDescriptions: ["星期一: 09:00–18:00"] },
        regularOpeningHours: {
          weekdayDescriptions: ["星期一: 09:00–18:00"],
          periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } }],
        },
      },
    };
    const display = resolveHomeNearbyHoursDisplay(pick);
    expect(display.hoursLabel).not.toBe("暫時無法確認營業時間");
    expect([display.statusLabel, display.hoursLabel].join(" ")).toMatch(/營業|今日|待確認/);
  });

  it("enrichHomeNearbyPicks logs PLACE_DETAILS_ENRICH_* and merges photoName", async () => {
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const picks: HomeNearbyPick[] = [
      {
        id: "ChIJ_enrich_test",
        name: "測試店",
        address: null,
        lat: 25,
        lng: 121,
        rating: 4,
        userRatingCount: 1,
        photoName: null,
        primaryType: "cafe",
        businessStatus: "OPERATIONAL",
        openStatus: "unknown",
        openStatusLabel: "",
        todayHoursLabel: "",
        closesAtLabel: "",
        closingSoonNote: "",
        nextOpenHint: "",
        reason: "附近",
        categoryId: "cafe",
      },
    ];

    const enriched = await enrichHomeNearbyPicks(picks, async () => ({
      place: {
        id: "ChIJ_enrich_test",
        name: "測試店",
        address: "地址",
        lat: 25,
        lng: 121,
        rating: 4,
        userRatingCount: 1,
        photoName: "places/ChIJ_enrich_test/photos/p1",
        photoNames: ["places/ChIJ_enrich_test/photos/p1"],
        primaryType: "cafe",
        types: ["cafe"],
        businessStatus: "OPERATIONAL",
        openStatus: "open",
        openStatusLabel: "營業中",
        todayHoursLabel: "今日 09:00–18:00",
        closesAtLabel: "營業至 18:00",
        closingSoonNote: "",
        nextOpenHint: "",
        website: null,
        phone: null,
        hoursData: {
          businessStatus: "OPERATIONAL",
          currentOpeningHours: { openNow: true },
          regularOpeningHours: {
            weekdayDescriptions: ["星期一: 09:00–18:00"],
          },
        },
      },
      error: null,
    }), "zh-TW");

    expect(enriched).toHaveLength(1);
    expect(enriched[0]!.photoName).toBe("places/ChIJ_enrich_test/photos/p1");
    expect(enriched[0]!.coverImageUrl).toBeNull();
    expect(resolveHomeNearbyImageSource(enriched[0]!)).toBe("google");

    const flat = logs.map((a) => JSON.stringify(a)).join("\n");
    expect(flat).toContain("[PLACE_DETAILS_ENRICH_START]");
    expect(flat).toContain("[PLACE_DETAILS_ENRICH_SUCCESS]");

    spy.mockRestore();
  });

  it("HomeNearbyPlaceCards imports render-time [HOME_NEARBY_CARD_DATA] log", async () => {
    const mod = await import("@/components/home/HomeNearbyPlaceCards.tsx");
    expect(mod.HomeNearbyPlaceCards).toBeTypeOf("function");
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../components/home/HomeNearbyPlaceCards.tsx", import.meta.url),
        "utf8",
      ),
    );
    expect(src).toContain("logHomeNearbyCardData");
    expect(src).toContain("pickPrimaryPhotoName");
    expect(src).toContain("resolveHomeNearbyHoursDisplay");
  });
});
