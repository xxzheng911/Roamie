import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import type { ClientContextBundle } from "@/lib/fetch-context";
import type { TripLocation } from "@/lib/location/types";

const dest: TripLocation = {
  placeId: "ChIJtest",
  country: "日本",
  city: "東京",
  lat: 35.68,
  lng: 139.76,
  formattedName: "日本・東京",
  displayLabel: "日本・東京",
};

const form: PlanTripFormInput = {
  destination: dest,
  origin: null,
  days: 2,
  mood: "",
  styles: ["文化"],
  interests: "",
  startDate: "2026-08-01",
  endDate: "2026-08-02",
  departureTime: "",
  travelers: 2,
  transport: "步行",
  budgetMode: "standard",
};

const bundle: ClientContextBundle = {
  preferences: { budgetMode: "standard", interests: [] },
  location: { lat: 35.68, lng: 139.76, city: "東京", country: "日本" },
  weather: null,
  time: new Date().toISOString(),
  usedFallbackLocation: false,
};

const logInfo = vi.spyOn(console, "info").mockImplementation(() => {});
const logWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

vi.mock("@/lib/profile-storage", () => ({
  getUserProfile: vi.fn().mockRejectedValue(new Error("profile timeout")),
}));

vi.mock("@/lib/ai/plus-memory-for-itinerary", () => ({
  resolvePlusMemoryForItinerary: vi.fn().mockResolvedValue({ memoryBlock: "" }),
  appendPlusMemoryToSummary: vi.fn((s: string) => s),
}));

vi.mock("@/lib/generate-itinerary-api", () => ({
  shouldUseBundledGenerateItineraryApi: () => false,
  generateItineraryViaBundledApi: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

vi.mock("@/services/placeImageService", () => ({
  getTripCoverImage: vi.fn().mockResolvedValue({ url: "" }),
}));

vi.mock("@/services/routesService", () => ({
  getTripLegsWithDurations: vi.fn().mockResolvedValue([]),
  travelLabelToRoutesMode: () => "walk",
}));

vi.mock("@/lib/itinerary-storage", () => ({
  confirmSaveTrip: vi.fn(async () => ({
    id: "saved-trip-1",
    title: "東京小旅行",
    custom_title: null,
    is_title_customized: false,
    mood: null,
    cover_image: null,
    cover_image_url: null,
    custom_cover_image_url: null,
    is_cover_customized: false,
    cover_source: null,
    cover_query: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    payload: { version: 2, title: "東京", itinerary: [{ date: "2026-08-01", time: "10:00" }] },
  })),
}));

import { generateAndSaveItineraryFromPlan } from "@/lib/trip/generate-itinerary-from-plan";

describe("generateAndSaveItineraryFromPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logInfo.mockClear();
    logWarn.mockClear();
  });

  it("logs OpenAI request start before calling generateItinerary", async () => {
    const generateItinerary = vi.fn().mockResolvedValue({
      itinerary: {
        version: 2,
        title: "東京二日",
        summary: "test",
        moodTag: "",
        recommendations: [],
        itinerary: [
          {
            date: "2026-08-01",
            time: "10:00",
            title: "淺草",
            placeName: "淺草寺",
            lat: 35.71,
            lng: 139.8,
          },
        ],
        destination: "東京",
        days: 2,
        generatedAt: new Date().toISOString(),
        userSaved: true,
      },
    });

    let openAiStarted = false;
    await generateAndSaveItineraryFromPlan(
      form,
      bundle,
      bundle.preferences,
      { locale: "zh-TW", searchNearbyPlaces: vi.fn(), generateItinerary },
      undefined,
      undefined,
      {
        onOpenAiRequestStart: () => {
          openAiStarted = true;
        },
      },
    );

    expect(openAiStarted).toBe(true);
    expect(generateItinerary).toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      "[PLAN_AI_OPENAI_REQUEST_START]",
      expect.any(Object),
    );
    expect(logInfo).toHaveBeenCalledWith(
      "[PLAN_AI_OPENAI_RESPONSE_RECEIVED]",
      expect.any(Object),
    );
    expect(logInfo).toHaveBeenCalledWith("[PLAN_AI_PARSE_SUCCESS]", expect.any(Object));
    expect(logInfo).toHaveBeenCalledWith("[PLAN_AI_TRIP_CREATED]", expect.any(Object));
    expect(logInfo).toHaveBeenCalledWith("[PLAN_AI_SAVE_SUCCESS]", expect.any(Object));
  });

  it("uses local fallback when OpenAI throws unavailable error", async () => {
    const generateItinerary = vi
      .fn()
      .mockRejectedValue(new Error("AI service unavailable"));

    const saved = await generateAndSaveItineraryFromPlan(
      form,
      bundle,
      bundle.preferences,
      { locale: "zh-TW", searchNearbyPlaces: vi.fn(), generateItinerary },
    );

    expect(saved.id).toBe("saved-trip-1");
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining("[TRIP_GENERATION_ERROR] plan local fallback:"),
      expect.any(String),
    );
    expect(logInfo).toHaveBeenCalledWith(
      "[PLAN_AI_OPENAI_RESPONSE_RECEIVED]",
      expect.objectContaining({ usedLocalFallback: true }),
    );
  });
});
