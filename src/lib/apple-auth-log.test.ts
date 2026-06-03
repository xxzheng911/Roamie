import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  APPLE_SIGN_IN_TEMP_FAIL_MSG,
  emitAppleAuthMarker,
  logAppleAuthIdTokenMissing,
  logAppleAuthNavigateHome,
  logAppleAuthTokenExchangeStart,
} from "@/lib/apple-auth-log";

describe("apple-auth-log", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("exports user-facing temp fail message", () => {
    expect(APPLE_SIGN_IN_TEMP_FAIL_MSG).toBe("Apple 登入暫時失敗，請稍後再試");
  });

  it("emits navigate home as single error line", () => {
    logAppleAuthNavigateHome("/");
    expect(console.error).toHaveBeenCalledWith('[APPLE_AUTH_NAVIGATE_HOME] {"target":"/"}');
  });

  it("emits token exchange start as single error line", () => {
    logAppleAuthTokenExchangeStart({
      host: "x.supabase.co",
      attempt: 1,
      via: "signInWithIdToken",
    });
    expect(console.error).toHaveBeenCalledWith(
      '[APPLE_AUTH_TOKEN_EXCHANGE_START] {"host":"x.supabase.co","attempt":1,"via":"signInWithIdToken"}',
    );
  });

  it("emits id token missing", () => {
    logAppleAuthIdTokenMissing({ inputType: "null", tokenLength: 0, looksLikeJwt: false });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[APPLE_AUTH_ID_TOKEN_MISSING]"),
    );
  });

  it("emitAppleAuthMarker without detail", () => {
    emitAppleAuthMarker("[APPLE_AUTH_BUTTON_PRESSED]");
    expect(console.error).toHaveBeenCalledWith("[APPLE_AUTH_BUTTON_PRESSED]");
  });
});
