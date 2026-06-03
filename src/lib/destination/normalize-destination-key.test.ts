import { describe, expect, it } from "vitest";
import { normalizeDestinationKey } from "@/lib/destination/normalize-destination-key";

describe("normalizeDestinationKey", () => {
  it("maps major destinations to shared cache keys", () => {
    expect(normalizeDestinationKey("東京")).toBe("tokyo");
    expect(normalizeDestinationKey("大阪")).toBe("osaka");
    expect(normalizeDestinationKey("京都")).toBe("kyoto");
    expect(normalizeDestinationKey("首爾")).toBe("seoul");
    expect(normalizeDestinationKey("台北")).toBe("taipei");
  });

  it("maps variants and embedded labels to the same key", () => {
    expect(normalizeDestinationKey("Tokyo")).toBe("tokyo");
    expect(normalizeDestinationKey("東京三日遊")).toBe("tokyo");
    expect(normalizeDestinationKey("大阪, 日本")).toBe("osaka");
    expect(normalizeDestinationKey("서울 여행")).toBe("seoul");
    expect(normalizeDestinationKey("臺北市")).toBe("taipei");
  });

  it("uses the same key for different trip title phrasings", () => {
    const tokyoA = normalizeDestinationKey("東京");
    const tokyoB = normalizeDestinationKey("東京自由行");
    const tokyoC = normalizeDestinationKey("日本東京");
    expect(tokyoA).toBe(tokyoB);
    expect(tokyoB).toBe(tokyoC);
  });
});
