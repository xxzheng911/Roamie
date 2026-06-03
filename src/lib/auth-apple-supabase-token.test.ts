import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-project-url", () => ({
  readSupabaseProjectUrl: () => "https://testproject.supabase.co",
}));

vi.mock("@/lib/supabase-auth-storage", () => ({
  warmSupabaseAuthStorage: vi.fn().mockResolvedValue(undefined),
  clearAuthMemoryCache: vi.fn(),
}));

vi.mock("@/lib/capacitor-bridge-ready", () => ({
  waitForCapacitorBridge: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/services/platform", () => ({
  detectPlatform: () => ({ isCapacitor: false }),
}));

const { mockSignInWithIdToken, mockSignOut, mockSetSession } = vi.hoisted(() => ({
  mockSignInWithIdToken: vi.fn(),
  mockSignOut: vi.fn().mockResolvedValue({ error: null }),
  mockSetSession: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithIdToken: mockSignInWithIdToken,
      signOut: mockSignOut,
      setSession: mockSetSession,
    },
  },
}));

vi.mock("@/lib/native-capacitor-http", () => ({
  nativeHttpRequest: vi.fn(),
}));

import { nativeHttpRequest } from "@/lib/native-capacitor-http";
import {
  clearPartialAppleAuthSession,
  exchangeAppleIdTokenWithSupabase,
} from "@/lib/auth-apple-supabase-token";

describe("exchangeAppleIdTokenWithSupabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key-123456789012345");
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: { user: { id: "u1" } } },
      error: null,
    });
  });

  it("uses signInWithIdToken with provider apple and nonce", async () => {
    const result = await exchangeAppleIdTokenWithSupabase("id-token", "raw-nonce");
    expect(result.session?.user?.id).toBe("u1");
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: "apple",
      token: "id-token",
      nonce: "raw-nonce",
    });
    expect(nativeHttpRequest).not.toHaveBeenCalled();
  });

  it("dedupes concurrent exchange calls", async () => {
    let resolveSignIn!: () => void;
    mockSignInWithIdToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignIn = () =>
            resolve({ data: { session: { user: { id: "u2" } } }, error: null });
        }),
    );
    const p1 = exchangeAppleIdTokenWithSupabase("t1", "n1");
    const p2 = exchangeAppleIdTokenWithSupabase("t1", "n1");
    resolveSignIn();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.session?.user?.id).toBe("u2");
    expect(r2.session?.user?.id).toBe("u2");
    expect(mockSignInWithIdToken).toHaveBeenCalledTimes(1);
  });

  it("clears local session on clearPartialAppleAuthSession", async () => {
    await clearPartialAppleAuthSession();
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
