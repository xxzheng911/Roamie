import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getSupabaseEnvCheckSnapshot,
  normalizeSupabaseProjectUrl,
  readViteSupabaseAnonKey,
  readViteSupabaseUrl,
} from "@/lib/vite-supabase-env";

describe("vite-supabase-env", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://abc123.supabase.co/rest/v1/");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.test_key_padding_xx");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes rest/v1 suffix", () => {
    expect(normalizeSupabaseProjectUrl("https://abc123.supabase.co/rest/v1/")).toBe(
      "https://abc123.supabase.co",
    );
  });

  it("reads only VITE_* url and anon key", () => {
    expect(readViteSupabaseUrl()).toBe("https://abc123.supabase.co");
    expect(readViteSupabaseAnonKey()?.startsWith("eyJ")).toBe(true);
  });

  it("builds env check snapshot", () => {
    expect(getSupabaseEnvCheckSnapshot()).toMatchObject({
      hasUrl: true,
      urlHost: "abc123.supabase.co",
      hasAnonKey: true,
      urlIssue: null,
      keyIssue: null,
    });
  });

  it("flags missing anon key", () => {
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    expect(getSupabaseEnvCheckSnapshot().keyIssue).toBe("missing_VITE_SUPABASE_ANON_KEY");
  });
});
