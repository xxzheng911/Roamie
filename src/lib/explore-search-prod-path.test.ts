import { describe, expect, it } from "vitest";
import { resolveExploreSearchApiKey } from "@/lib/explore-search-diagnostic";
import { executeExploreSearch } from "@/lib/places.functions";

/** Live Google calls; opt in with RUN_EXPLORE_SEARCH_LIVE_TESTS=1 */
const runLiveExplore =
  process.env.RUN_EXPLORE_SEARCH_LIVE_TESTS === "1" &&
  Boolean(resolveExploreSearchApiKey());

describe.skipIf(!runLiveExplore)("executeExploreSearch map text", () => {
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
