import { isSupabaseConfigured } from "@/integrations/supabase/client";

/** 讀取專案 Supabase URL（build 時須帶入 VITE_SUPABASE_URL） */
export function readSupabaseProjectUrl(): string | null {
  const raw = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!raw?.trim()) return null;
  return raw.replace(/\/(rest|auth)\/v1\/?$/i, "").replace(/\/$/, "");
}

export function readSupabaseAuthCallbackUrl(): string | null {
  const base = readSupabaseProjectUrl();
  return base ? `${base}/auth/v1/callback` : null;
}

export function assertSupabaseConfiguredForAuth(): string | null {
  if (!isSupabaseConfigured()) {
    return "雲端登入未設定：請在 build 時帶入 VITE_SUPABASE_URL 與 VITE_SUPABASE_PUBLISHABLE_KEY 後重新安裝 App。";
  }
  return null;
}
