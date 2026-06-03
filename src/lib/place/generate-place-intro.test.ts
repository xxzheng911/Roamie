import { describe, expect, it, vi } from "vitest";
import {
  generatePlaceIntro,
  logPlaceIntroFallbackUsed,
} from "./generate-place-intro";
import { PLACE_INTRO_GENERIC_FALLBACK } from "./place-intro-constants";

describe("generatePlaceIntro", () => {
  it("generates landmark-specific intro for 淺草寺", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = generatePlaceIntro(
      { placeName: "淺草寺", city: "東京" },
      { travelMonth: 12, destination: "東京" },
      { locale: "zh-TW" },
    );
    expect(result.intro).toContain("淺草寺");
    expect(result.intro).not.toBe(PLACE_INTRO_GENERIC_FALLBACK);
    expect(result.intro).toMatch(/雷門|仲見世|寺院/);
    expect(info.mock.calls.some((c) => c[0] === "[PLACE_INTRO_GENERATE_SUCCESS]")).toBe(
      true,
    );
    info.mockRestore();
  });

  it("generates specific intro for 哈利波特影城", () => {
    const result = generatePlaceIntro(
      { placeName: "東京哈利波特影城" },
      { destination: "東京" },
    );
    expect(result.intro).toMatch(/半天|預約|沉浸式/);
    expect(result.intro).not.toBe(PLACE_INTRO_GENERIC_FALLBACK);
  });

  it("generates specific intro for 富士山", () => {
    const result = generatePlaceIntro(
      { placeName: "富士山五合目" },
      { travelMonth: 12, destination: "東京" },
    );
    expect(result.intro).toMatch(/一日|河口湖|市區/);
    expect(result.intro).not.toBe(PLACE_INTRO_GENERIC_FALLBACK);
  });

  it("uses generic fallback only when place name is empty", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logPlaceIntroFallbackUsed({ placeName: "(empty)", reason: "test" });
    const result = generatePlaceIntro({ placeName: "" }, {});
    expect(result.intro).toBe(PLACE_INTRO_GENERIC_FALLBACK);
    expect(info.mock.calls.some((c) => c[0] === "[PLACE_INTRO_FALLBACK_USED]")).toBe(true);
    info.mockRestore();
  });

  it("uses distinct recommendReason for 雷門 and 仲見世", () => {
    const kaminari = generatePlaceIntro({ placeName: "雷門" }, { destination: "東京" });
    const nakamise = generatePlaceIntro({ placeName: "仲見世商店街" }, { destination: "東京" });
    expect(kaminari.recommendReason).toContain("最具代表性");
    expect(nakamise.recommendReason).toContain("連接雷門");
    expect(kaminari.recommendReason).not.toBe(nakamise.recommendReason);
  });

  it("builds minimal intro from place name without Google data", () => {
    const result = generatePlaceIntro(
      { placeName: "未知小店", category: "餐廳", city: "大阪" },
      { destination: "大阪", dayIndex: 2 },
    );
    expect(result.intro).toContain("未知小店");
    expect(result.intro).not.toBe(PLACE_INTRO_GENERIC_FALLBACK);
  });
});
