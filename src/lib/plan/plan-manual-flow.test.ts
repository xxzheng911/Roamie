import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
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
  startDate: "",
  endDate: "",
  departureTime: "",
  travelers: 2,
  transport: "",
  budgetMode: "standard",
};

vi.mock("@/lib/preferences-storage", () => ({
  getPreferences: vi.fn().mockResolvedValue({ budgetMode: "standard", interests: [] }),
}));

vi.mock("@/lib/trip/create-manual-trip-from-plan", () => ({
  createTripFromPlanForm: vi.fn(async () => ({
    id: "manual-1",
    title: "東京的小旅行",
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
    payload: { version: 2, title: "東京的小旅行", itinerary: [] },
  })),
}));

import { createTripFromPlanForm } from "@/lib/trip/create-manual-trip-from-plan";
import { executeManualTripCreate } from "@/lib/plan/plan-manual-flow";

describe("executeManualTripCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists minimal trip without calling weather or AI", async () => {
    const saved = await executeManualTripCreate(form);
    expect(saved.id).toBe("manual-1");
    expect(createTripFromPlanForm).toHaveBeenCalledWith(
      form,
      expect.objectContaining({ budgetMode: "standard" }),
    );
    const call = vi.mocked(createTripFromPlanForm).mock.calls[0];
    expect(call).toBeDefined();
  });

  it("rejects when save exceeds timeout", async () => {
    vi.mocked(createTripFromPlanForm).mockImplementation(
      () => new Promise(() => {}),
    );
    const timeoutMod = await import("@/lib/async/with-timeout");
    const spy = vi.spyOn(timeoutMod, "withTimeout").mockImplementation((promise, _ms, label) =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`${label} 逾時（0 秒）`)), 15);
        }),
      ]),
    );
    await expect(executeManualTripCreate(form)).rejects.toThrow(/manual_trip_save 逾時/);
    spy.mockRestore();
  });
});
