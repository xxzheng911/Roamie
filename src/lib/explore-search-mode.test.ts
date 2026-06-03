import { describe, expect, it } from "vitest";
import { detectExploreSearchMode } from "@/lib/explore-search-mode";

describe("detectExploreSearchMode", () => {
  it("detects 富士山 as global_place", () => {
    expect(detectExploreSearchMode("富士山").mode).toBe("global_place");
  });

  it("detects 東京鐵塔 as global_place", () => {
    expect(detectExploreSearchMode("東京鐵塔").mode).toBe("global_place");
  });

  it("detects 咖啡廳 as nearby_category", () => {
    expect(detectExploreSearchMode("咖啡廳").mode).toBe("nearby_category");
  });

  it("detects Starbucks as nearby_category", () => {
    expect(detectExploreSearchMode("Starbucks").mode).toBe("nearby_category");
  });
});
