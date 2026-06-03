import { describe, it } from "vitest";
import { diagnoseExploreMapTextSearch } from "@/lib/explore-search-diagnostic";

describe("explore search diagnostic (高雄車站)", () => {
  it("prints pipeline counts for 高雄車站", async () => {
    const report = await diagnoseExploreMapTextSearch({
      query: "高雄車站",
      rawQuery: "高雄車站",
      lat: 22.63,
      lng: 120.3,
      radius: 15_000,
      mode: "text",
      locale: "zh-TW",
      availabilityContext: "lenient",
      telemetrySurface: "map",
      exploreMapTextSearch: true,
    });

    const summary = {
      query: report.query,
      resultCount: report.executeExploreResultCount,
      firstPlaceName: report.executeExploreFirstPlaceName,
      error: report.executeExploreError,
      enteredAvailabilityFilter: report.enteredAvailabilityFilter,
      googleRawCount: report.googleRawCount,
      afterAvailabilityCount: report.afterAvailabilityCount,
      afterPermissiveTypeCount: report.afterPermissiveTypeCount,
      afterDistanceCount: report.afterDistanceCount,
      clientFilterBeforeCount: report.clientFilterBeforeCount,
      clientFilterAfterCount: report.clientFilterAfterCount,
      enteredClientMapTextFilter: report.enteredClientMapTextFilter,
      apiKeyPresent: report.apiKeyPresent,
      googleHttpStatus: report.googleHttpStatus,
      googleFirstPlaceName: report.googleFirstPlaceName,
      googleError: report.googleError,
    };

    console.info("\n[EXPLORE_SEARCH_DIAGNOSTIC_SUMMARY]", JSON.stringify(summary, null, 2));
    console.info("\n[EXPLORE_SEARCH_DIAGNOSTIC_FULL]", JSON.stringify(report, null, 2));
  });
});
