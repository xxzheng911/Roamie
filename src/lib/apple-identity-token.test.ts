import { describe, expect, it } from "vitest";
import { normalizeAppleIdentityToken } from "@/lib/apple-identity-token";

describe("normalizeAppleIdentityToken", () => {
  it("trims string JWT", () => {
    const jwt = "aaa.bbb.ccc";
    const r = normalizeAppleIdentityToken(`  ${jwt}  `);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.token).toBe(jwt);
      expect(r.meta.looksLikeJwt).toBe(true);
    }
  });

  it("unwraps nested identityToken object", () => {
    const r = normalizeAppleIdentityToken({ identityToken: "x.y.z" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.token).toBe("x.y.z");
  });

  it("returns false for empty string", () => {
    const r = normalizeAppleIdentityToken("   ");
    expect(r.ok).toBe(false);
  });
});
