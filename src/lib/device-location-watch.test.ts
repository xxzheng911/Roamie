import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/location-permission-manager", () => ({
  ensureLocationPermission: vi.fn(async () => "granted"),
  getCachedLocationPermission: vi.fn(() => "unknown"),
}));

vi.mock("@/services/platform", () => ({
  detectPlatform: () => ({ isCapacitor: false, isIOS: false, isAndroid: false }),
}));

describe("watchDeviceLocation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("ignores home scope without starting hardware watch", async () => {
    const logs: string[] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      if (typeof args[0] === "string") logs.push(args[0]);
      orig(...args);
    };

    const { watchDeviceLocation } = await import("@/lib/device-location");
    const cleanup = watchDeviceLocation(() => {}, { scope: "home" });
    cleanup();

    console.info = orig;
    expect(logs.some((l) => l.includes("[LOCATION_WATCH_IGNORED_HOME]"))).toBe(true);
    expect(logs.some((l) => l.includes("[LOCATION_WATCH_STARTED]"))).toBe(false);
  });
});
