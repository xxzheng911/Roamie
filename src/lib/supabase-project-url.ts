import { isSupabaseConfigured } from "@/integrations/supabase/client";
import { readSupabaseEnvForClient } from "@/lib/supabase-env";

/** 讀取專案 Supabase URL（build 時須帶入 VITE_SUPABASE_URL） */
export function readSupabaseProjectUrl(): string | null {
  return readSupabaseEnvForClient().url ?? null;
}

export function readSupabaseProjectHost(): string | null {
  const base = readSupabaseProjectUrl();
  if (!base) return null;
  try {
    return new URL(base).hostname;
  } catch {
    return null;
  }
}

/** build 誤用 placeholder / localhost 時，原生裝置無法解析 Supabase */
export function diagnoseSupabaseUrlForNativeBuild(): string | null {
  const base = readSupabaseProjectUrl();
  if (!base) return "missing_url";
  try {
    const { hostname, protocol } = new URL(base);
    if (protocol !== "https:") return `non_https:${protocol}`;
    if (hostname === "placeholder.supabase.co") return "placeholder_host";
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".local")
    ) {
      return `dev_host:${hostname}`;
    }
  } catch {
    return "invalid_url";
  }
  return null;
}

export function readSupabaseAuthCallbackUrl(): string | null {
  const base = readSupabaseProjectUrl();
  return base ? `${base}/auth/v1/callback` : null;
}

export function assertSupabaseConfiguredForAuth(): string | null {
  if (!isSupabaseConfigured()) {
    return "雲端登入未設定：請在 build 時帶入 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY 後重新安裝 App。";
  }
  return null;
}
