import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TripLocation } from "@/lib/location/types";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";

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
  endDate: "2026-08-03",
  departureTime: "",
  travelers: 2,
  transport: "步行",
  budgetMode: "standard",
};

const prefs = { budgetMode: "standard" as const, interests: [] };

const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});

vi.mock("@/lib/plan/plan-context-bundle", () => ({
  buildPlanContextBundleOptionalWeather: vi.fn(async () => ({
    preferences: prefs,
    location: { lat: 35.68, lng: 139.76, city: "東京", country: "日本" },
    weather: null,
    time: new Date().toISOString(),
    usedFallbackLocation: false,
  })),
}));

vi.mock("@/lib/trip/generate-itinerary-from-plan", () => ({
  generateAndSaveItineraryFromPlan: vi.fn(),
}));

import { buildPlanContextBundleOptionalWeather } from "@/lib/plan/plan-context-bundle";
import { generateAndSaveItineraryFromPlan } from "@/lib/trip/generate-itinerary-from-plan";
import {
  executePlanAiGeneration,
  fetchPlanAiBundleWithOptionalWeather,
} from "@/lib/plan/plan-ai-flow";

describe("plan AI flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logSpy.mockClear();
  });

  it("logs PLAN_AI_AFTER_WEATHER on success path", async () => {
    vi.mocked(buildPlanContextBundleOptionalWeather).mockResolvedValueOnce({
      preferences: prefs,
      location: { lat: 35.68, lng: 139.76, city: "東京", country: "日本" },
      weather: { available: true, city: "東京", condition: "晴", tempC: 20, source: "x" },
      time: new Date().toISOString(),
      usedFallbackLocation: false,
    });

    await fetchPlanAiBundleWithOptionalWeather(dest, vi.fn(), prefs);
    expect(logSpy).toHaveBeenCalledWith(
      "[PLAN_AI_AFTER_WEATHER]",
      expect.objectContaining({ hasWeather: true }),
    );
  });

  it("logs PLAN_AI_AFTER_WEATHER when weather unavailable", async () => {
    await fetchPlanAiBundleWithOptionalWeather(dest, vi.fn(), prefs);
    expect(logSpy).toHaveBeenCalledWith(
      "[PLAN_AI_AFTER_WEATHER]",
      expect.objectContaining({ hasWeather: false }),
    );
  });

  it("calls generateAndSave after weather bundle", async () => {
    const bundle = await fetchPlanAiBundleWithOptionalWeather(dest, vi.fn(), prefs);
    let openAiStarted = false;
    vi.mocked(generateAndSaveItineraryFromPlan).mockImplementation(async (...args) => {
      const opts = args[6] as { onOpenAiRequestStart?: () => void } | undefined;
      opts?.onOpenAiRequestStart?.();
      return {
        id: "trip-ai-1",
        title: "東京",
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
        payload: { version: 2, title: "東京", itinerary: [] },
      };
    });

    const saved = await executePlanAiGeneration(
      {
        destination: dest,
        form,
        prefs,
        fetchWeather: vi.fn(),
        deps: {
          locale: "zh-TW",
          searchNearbyPlaces: vi.fn(),
          generateItinerary: vi.fn(),
        },
        generationOptions: {
          onOpenAiRequestStart: () => {
            openAiStarted = true;
          },
        },
      },
      bundle,
    );
    expect(saved.id).toBe("trip-ai-1");
    expect(openAiStarted).toBe(true);
    expect(generateAndSaveItineraryFromPlan).toHaveBeenCalled();
  });
});
