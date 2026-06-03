import { describe, expect, it } from "vitest";
import { buildTripStopSearchQuery } from "@/lib/trip/build-trip-stop-search-query";

describe("buildTripStopSearchQuery", () => {
  it("prefixes destination when user input lacks it", () => {
    expect(buildTripStopSearchQuery("晴空塔", "東京")).toBe("東京 晴空塔");
    expect(buildTripStopSearchQuery("拉麵", "東京")).toBe("東京 拉麵");
  });

  it("does not duplicate destination already in query", () => {
    expect(buildTripStopSearchQuery("東京 晴空塔", "東京")).toBe("東京 晴空塔");
  });

  it("returns user input when destination unset", () => {
    expect(buildTripStopSearchQuery("晴空塔", "尚未設定")).toBe("晴空塔");
    expect(buildTripStopSearchQuery("晴空塔", null)).toBe("晴空塔");
  });
});
