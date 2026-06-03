/**
 * 瀏覽器 / Capacitor client 僅讀 Vite 內嵌變數（build 時由 .env 寫入）。
 * 不讀 process.env.SUPABASE_*、不讀 localhost fallback。
 */

const PLACEHOLDER_HOST = "placeholder.supabase.co";

function readViteString(key: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string | undefined {
  const v = import.meta.env[key];
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  if (!trimmed || trimmed === "undefined") return undefined;
  return trimmed;
}

export function normalizeSupabaseProjectUrl(url: string): string {
  return url.replace(/\/(rest|auth)\/v1\/?$/i, "").replace(/\/$/, "");
}

export function readViteSupabaseUrl(): string | undefined {
  const raw = readViteString("VITE_SUPABASE_URL");
  return raw ? normalizeSupabaseProjectUrl(raw) : undefined;
}

export function readViteSupabaseAnonKey(): string | undefined {
  return readViteString("VITE_SUPABASE_ANON_KEY");
}

export type SupabaseEnvCheckSnapshot = {
  hasUrl: boolean;
  urlHost: string | null;
  hasAnonKey: boolean;
  anonKeyPrefix: string | null;
  urlIssue: string | null;
  keyIssue: string | null;
};

export function getSupabaseEnvCheckSnapshot(): SupabaseEnvCheckSnapshot {
  const url = readViteSupabaseUrl();
  const key = readViteSupabaseAnonKey();
  let urlHost: string | null = null;
  let urlIssue: string | null = null;

  if (!url) {
    urlIssue = "missing_url";
  } else {
    try {
      const parsed = new URL(url);
      urlHost = parsed.hostname;
      if (parsed.protocol !== "https:") urlIssue = `non_https:${parsed.protocol}`;
      else if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        urlIssue = `localhost:${parsed.hostname}`;
      } else if (parsed.hostname === PLACEHOLDER_HOST) urlIssue = "placeholder_host";
      else if (!/\.supabase\.co$/i.test(parsed.hostname)) {
        urlIssue = `unexpected_host:${parsed.hostname}`;
      }
    } catch {
      urlIssue = "invalid_url";
    }
  }

  let keyIssue: string | null = null;
  if (!key) keyIssue = "missing_VITE_SUPABASE_ANON_KEY";
  else if (key.length < 20) keyIssue = "anon_key_too_short";

  return {
    hasUrl: Boolean(url),
    urlHost,
    hasAnonKey: Boolean(key),
    anonKeyPrefix: key ? key.slice(0, 8) : null,
    urlIssue,
    keyIssue,
  };
}

export function logSupabaseEnvCheck(): void {
  const snapshot = getSupabaseEnvCheckSnapshot();
  console.error(`[SUPABASE_ENV_CHECK] ${JSON.stringify(snapshot)}`);
}

export function isSupabaseViteEnvValid(): boolean {
  const s = getSupabaseEnvCheckSnapshot();
  return s.hasUrl && s.hasAnonKey && !s.urlIssue && !s.keyIssue;
}
