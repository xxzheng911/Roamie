import { describe, expect, it } from "vitest";
import {
  describeAuthError,
  mapAppleExchangeErrorToUserMessage,
} from "@/lib/apple-auth-error";

describe("describeAuthError", () => {
  it("reads Supabase-style code and status", () => {
    const err = Object.assign(new Error("Nonces mismatch"), {
      code: "nonce_mismatch",
      status: 400,
    });
    expect(describeAuthError(err)).toMatchObject({
      message: "Nonces mismatch",
      code: "nonce_mismatch",
      status: 400,
    });
  });
});

describe("mapAppleExchangeErrorToUserMessage", () => {
  it("maps nonce mismatch to actionable message", () => {
    const msg = mapAppleExchangeErrorToUserMessage({ message: "Nonces mismatch" });
    expect(msg).toContain("nonce");
  });

  it("does not use generic temp fail for explicit 401 body", () => {
    const msg = mapAppleExchangeErrorToUserMessage({
      message: "Invalid API key",
      status: 401,
    });
    expect(msg).toBe("Invalid API key");
  });

  it("maps cannot find host to supabase url hint", () => {
    const err = Object.assign(new Error("無法找到指定主機名稱的伺服器。"), {
      name: "AuthRetryableFetchError",
      status: 0,
    });
    const msg = mapAppleExchangeErrorToUserMessage(
      { message: err.message, name: err.name, status: 0 },
      err,
    );
    expect(msg).toContain("VITE_SUPABASE_URL");
  });
});
