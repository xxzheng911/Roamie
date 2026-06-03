import { describe, expect, it } from "vitest";
import { resolveHomeNearbyHoursDisplay } from "@/lib/home-nearby-card-display";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import {
  formatPlaceCardHoursLabel,
  resolvePlaceCardOpeningDisplay,
} from "@/lib/place-card-opening";

function badgeText(status: string, hours: string): string {
  return [status, hours].filter(Boolean).join(" · ");
}

describe("place-card-opening", () => {
  it("formats 24h hours without 今日營業時間 prefix", () => {
    expect(formatPlaceCardHoursLabel("今日 24 小時營業")).toBe("24 小時營業");
    const display = resolvePlaceCardOpeningDisplay({
      openStatus: "open",
      openStatusLabel: "營業中",
      todayHoursLabel: "今日 24 小時營業",
    });
    expect(display.statusLabel).toBe("營業中");
    expect(display.hoursLabel).toBe("24 小時營業");
    expect(badgeText(display.statusLabel, display.hoursLabel)).toBe("營業中 · 24 小時營業");
  });

  it("does not duplicate 營業中 on home nearby badge", () => {
    const pick = {
      id: "ChIJ_test",
      name: "德北公園",
      openStatus: "open",
      openStatusLabel: "營業中",
      todayHoursLabel: "今日 24 小時營業",
      closesAtLabel: "",
      businessStatus: "OPERATIONAL",
    } as HomeNearbyPick;
    const display = resolveHomeNearbyHoursDisplay(pick);
    const text = badgeText(display.statusLabel, display.hoursLabel);
    expect(text).toBe("營業中 · 24 小時營業");
    expect(text.match(/營業中/g)?.length).toBe(1);
  });

  it("shows closed status with today hours once", () => {
    const display = resolvePlaceCardOpeningDisplay({
      openStatus: "closed_now",
      todayHoursLabel: "今日 09:30–21:30",
    });
    expect(display.statusLabel).toBe("已打烊");
    expect(display.hoursLabel).toBe("今日 09:30–21:30");
  });
});
