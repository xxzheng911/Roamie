import { describe, expect, it, vi, beforeEach } from "vitest";

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  CapacitorHttp: { request: requestMock },
}));

vi.mock("@/services/platform", () => ({
  detectPlatform: () => ({ isCapacitor: true }),
}));

import { isNativeCapacitorShell, nativeHttpRequest } from "@/lib/native-capacitor-http";

describe("nativeHttpRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      location: { protocol: "capacitor:" },
    });
  });

  it("uses CapacitorHttp on capacitor protocol", async () => {
    expect(isNativeCapacitorShell()).toBe(true);
    requestMock.mockResolvedValue({
      status: 200,
      data: { ok: true },
    });

    const result = await nativeHttpRequest("https://example.supabase.co/auth/v1/token", "POST", {
      headers: { apikey: "key" },
      jsonBody: { provider: "apple" },
    });

    expect(requestMock).toHaveBeenCalled();
    expect(result.transport).toBe("capacitor_http");
    expect(result.status).toBe(200);
  });
});
