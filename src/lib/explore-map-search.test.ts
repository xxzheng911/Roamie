import { describe, expect, it } from "vitest";
import {
  buildExploreMapSearchQuery,
  filterExploreMapTextResults,
} from "@/lib/explore-map-search";
import type { PlaceResult } from "@/lib/place-result";

describe("buildExploreMapSearchQuery", () => {
  it("prefixes city for keyword search", () => {
    expect(buildExploreMapSearchQuery("咖啡廳", { city: "東京" })).toBe("東京 咖啡廳");
    expect(buildExploreMapSearchQuery("東京鐵塔", { city: "東京" })).toBe("東京鐵塔");
  });
});

describe("filterExploreMapTextResults", () => {
  const base = (overrides: Partial<PlaceResult>): PlaceResult => ({
    id: "p1",
    name: "測試",
    address: null,
    lat: 35,
    lng: 139,
    rating: 4,
    userRatingCount: 100,
    photoName: null,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...overrides,
  });

  it("allows hotel when query mentions 飯店", () => {
    const places = [
      base({
        name: "東京飯店",
        primaryType: "hotel",
        types: ["hotel", "lodging"],
      }),
    ];
    expect(filterExploreMapTextResults(places, "飯店").length).toBe(1);
  });
});
