import { describe, expect, it, vi } from "vitest";
import {
  buildManualTripPayloadFromPlan,
  defaultBlankTripTitle,
} from "@/lib/trip/create-manual-trip-from-plan";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import type { ClientContextBundle } from "@/lib/fetch-context";
import type { TripLocation } from "@/lib/location/types";

const tokyo: TripLocation = {
  placeId: "ChIJtest",
  country: "日本",
  city: "東京",
  lat: 35.68,
  lng: 139.76,
  formattedName: "日本・東京",
  displayLabel: "日本・東京",
};

const baseForm: PlanTripFormInput = {
  destination: tokyo,
  origin: null,
  days: 2,
  mood: "",
  styles: ["文化"],
  interests: "",
  startDate: "",
  endDate: "",
  departureTime: "",
  travelers: 2,
  transport: "大眾運輸",
  budgetMode: "standard",
};

const bundle: ClientContextBundle = {
  preferences: {} as ClientContextBundle["preferences"],
  location: { lat: 35.68, lng: 139.76, city: "東京", country: "日本" },
  weather: null,
  time: new Date().toISOString(),
  usedFallbackLocation: false,
};

vi.mock("@/lib/itinerary-storage", () => ({
  confirmSaveTrip: vi.fn(async (payload: unknown) => ({
    id: "trip-new-1",
    title: (payload as { title: string }).title,
    custom_title: null,
    is_title_customized: false,
    mood: null,
    cover_image: "https://example.com/cover.jpg",
    cover_image_url: null,
    custom_cover_image_url: null,
    is_cover_customized: false,
    cover_source: "default",
    cover_query: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    payload,
  })),
}));

describe("create manual trip from plan", () => {
  it("defaultBlankTripTitle uses destination area", () => {
    expect(defaultBlankTripTitle("日本・東京", "東京")).toBe("東京的小旅行");
    expect(defaultBlankTripTitle("台南")).toBe("台南的小旅行");
  });

  it("buildManualTripPayloadFromPlan creates empty itinerary without AI fields", () => {
    const payload = buildManualTripPayloadFromPlan(baseForm, bundle);
    expect(payload.title).toBe("東京的小旅行");
    expect(payload.itinerary).toEqual([]);
    expect(payload.recommendations).toEqual([]);
    expect(payload.travelers).toBe(2);
    expect(payload.tripSettings?.transport).toBe("transit");
    expect(payload.tripSettings?.tripStartDate).toBeUndefined();
    expect(payload.summary).toContain("尚未設定日期");
    expect(payload.aiGeneratedCoverImageUrl).toBeUndefined();
    expect((payload.coreTrip as Record<string, unknown>).budgetMode).toBe("standard");
  });

  it("persists start and end dates when provided", () => {
    const payload = buildManualTripPayloadFromPlan(
      { ...baseForm, startDate: "2026-08-01", endDate: "2026-08-05" },
      bundle,
    );
    expect(payload.tripSettings?.tripStartDate).toBe("2026-08-01");
    expect(payload.tripSettings?.tripEndDate).toBe("2026-08-05");
    expect(payload.days).toBe(5);
  });
});
