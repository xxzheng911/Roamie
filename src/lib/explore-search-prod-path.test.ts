import { describe, expect, it } from "vitest";
import { executeExploreSearch } from "@/lib/places.functions";

describe("executeExploreSearch map text", () => {
  it("returns 高雄車站 with exploreMapTextSearch", async () => {
    const r = await executeExploreSearch({
      query: "高雄車站",
      lat: 22.63,
      lng: 120.3,
      radius: 15_000,
      mode: "text",
      locale: "zh-TW",
      availabilityContext: "lenient",
      telemetrySurface: "map",
      exploreMapTextSearch: true,
    });
    expect(r.error).toBeNull();
    expect(r.places.length).toBeGreaterThan(0);
    expect(r.places[0]?.name).toMatch(/高雄車站/);
  });

  it("returns Stellar garden with exploreMapTextSearch", async () => {
    const r = await executeExploreSearch({
      query: "Stellar garden",
      lat: 22.63,
      lng: 120.3,
      radius: 15_000,
      mode: "text",
      locale: "zh-TW",
      availabilityContext: "lenient",
      telemetrySurface: "map",
      exploreMapTextSearch: true,
    });
    expect(r.places.length).toBeGreaterThan(0);
  });
});
