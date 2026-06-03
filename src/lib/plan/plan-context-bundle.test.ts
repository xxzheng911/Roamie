import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildPlanContextBundleOptionalWeather } from "@/lib/plan/plan-context-bundle";
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

const prefs = { budgetMode: "standard" as const, interests: [] };

vi.mock("@/services/weatherFetchAdapter", () => ({
  fetchWeatherForCoords: vi.fn(),
}));

vi.mock("@/lib/i18n/resolve-locale", () => ({
  resolveLocaleSync: () => "zh-TW",
}));

import { fetchWeatherForCoords } from "@/services/weatherFetchAdapter";

describe("buildPlanContextBundleOptionalWeather", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("continues with weather when fetch succeeds", async () => {
    vi.mocked(fetchWeatherForCoords).mockResolvedValue({
      weather: {
        available: true,
        city: "東京",
        condition: "晴",
        tempC: 22,
        source: "open-meteo-fallback",
      },
      error: null,
    });

    const bundle = await buildPlanContextBundleOptionalWeather(
      dest,
      vi.fn(),
      4_000,
      prefs,
    );
    expect(bundle.weather?.available).toBe(true);
    expect(bundle.location.lat).toBe(35.68);
  });

  it("continues without weather when fetch throws", async () => {
    vi.mocked(fetchWeatherForCoords).mockRejectedValue(new Error("network down"));

    const bundle = await buildPlanContextBundleOptionalWeather(
      dest,
      vi.fn(),
      4_000,
      prefs,
    );
    expect(bundle.weather).toBeNull();
    expect(bundle.location.city).toBeTruthy();
  });

  it("continues without weather when fetch times out", async () => {
    vi.mocked(fetchWeatherForCoords).mockImplementation(
      () => new Promise(() => {}),
    );

    const bundle = await buildPlanContextBundleOptionalWeather(
      dest,
      vi.fn(),
      50,
      prefs,
    );
    expect(bundle.weather).toBeNull();
  });
});
