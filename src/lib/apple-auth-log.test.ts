import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  APPLE_SIGN_IN_TEMP_FAIL_MSG,
  logAppleAuthNavigateHome,
  logAppleAuthTokenExchangeStart,
} from "@/lib/apple-auth-log";

describe("apple-auth-log", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("exports user-facing temp fail message", () => {
    expect(APPLE_SIGN_IN_TEMP_FAIL_MSG).toBe("Apple 登入暫時失敗，請稍後再試");
  });

  it("logs navigate home", () => {
    logAppleAuthNavigateHome("/");
    expect(console.info).toHaveBeenCalledWith("[APPLE_AUTH_NAVIGATE_HOME]", {
      target: "/",
    });
  });

  it("logs token exchange start", () => {
    logAppleAuthTokenExchangeStart({ host: "x.supabase.co", attempt: 1 });
    expect(console.info).toHaveBeenCalledWith("[APPLE_AUTH_TOKEN_EXCHANGE_START]", {
      host: "x.supabase.co",
      attempt: 1,
    });
  });
});
