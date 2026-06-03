import { describe, expect, it, vi, beforeEach } from "vitest";

const { browserOpen } = vi.hoisted(() => ({
  browserOpen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@capacitor/browser", () => ({
  Browser: { open: browserOpen },
}));

import { openAffiliateBrowser } from "./open-affiliate-browser";

describe("openAffiliateBrowser", () => {
  beforeEach(() => {
    browserOpen.mockClear();
  });

  it("calls Browser.open with url and logs success", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await openAffiliateBrowser("https://www.klook.com/zh-TW/search/result/?query=test", "klook");

    expect(browserOpen).toHaveBeenCalledWith({
      url: "https://www.klook.com/zh-TW/search/result/?query=test",
    });
    expect(info.mock.calls.some((c) => c[0] === "[AFFILIATE_BROWSER_OPEN_START]")).toBe(true);
    expect(info.mock.calls.some((c) => c[0] === "[AFFILIATE_BROWSER_OPEN_SUCCESS]")).toBe(true);

    info.mockRestore();
  });
});
