import { describe, expect, it } from "vitest";
import {
  isSupabaseConnectivityError,
  isSupabaseHostnameUnreachableError,
  userMessageForSupabaseError,
  SUPABASE_UNAVAILABLE_USER_MSG,
} from "@/lib/supabase-connectivity";

describe("supabase-connectivity", () => {
  it("detects statement timeout", () => {
    expect(
      isSupabaseConnectivityError(new Error("canceling statement due to statement timeout")),
    ).toBe(true);
  });

  it("detects connection terminated", () => {
    expect(
      isSupabaseConnectivityError(
        new Error("Connection terminated due to connection timeout"),
      ),
    ).toBe(true);
  });

  it("maps connectivity errors to user message", () => {
    expect(
      userMessageForSupabaseError(new Error("要求逾時。")),
    ).toBe(SUPABASE_UNAVAILABLE_USER_MSG);
  });

  it("detects iOS cannot find host", () => {
    const err = Object.assign(new Error("無法找到指定主機名稱的伺服器。"), {
      name: "AuthRetryableFetchError",
      status: 0,
    });
    expect(isSupabaseHostnameUnreachableError(err)).toBe(true);
    expect(isSupabaseConnectivityError(err)).toBe(false);
  });
});
