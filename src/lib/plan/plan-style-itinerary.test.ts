import { describe, expect, it } from "vitest";
import {
  buildStyleAwarePlaceSearchQueries,
  buildTravelStylePriorityPromptBlock,
  shouldSkipGenericDestinationLandmarks,
} from "@/lib/plan/plan-style-itinerary";

describe("plan-style-itinerary", () => {
  it("builds glamping search queries for Tokyo", () => {
    const q = buildStyleAwarePlaceSearchQueries("日本・東京", ["豪華露營"]);
    expect(q.some((s) => /glamping|露營|グランピング/i.test(s))).toBe(true);
    expect(q.some((s) => /箱根|河口湖|山中湖/.test(s))).toBe(true);
  });

  it("skips generic landmarks when style is specific", () => {
    expect(shouldSkipGenericDestinationLandmarks(["豪華露營"])).toBe(true);
    expect(shouldSkipGenericDestinationLandmarks([])).toBe(false);
  });

  it("prompt block forbids department stores for glamping", () => {
    const block = buildTravelStylePriorityPromptBlock(["豪華露營"]);
    expect(block).toContain("禁止");
    expect(block).toMatch(/百貨|夜市/);
    expect(block).toMatch(/Glamping|露營/);
  });
});
