import { supabase } from "@/integrations/supabase/client";

export const GUEST_FLAG_KEY = "roamie:guest";

export function readGuestFlag(): boolean {
  if (typeof window === "undefined") return false;
  return (
    localStorage.getItem(GUEST_FLAG_KEY) === "1" ||
    sessionStorage.getItem(GUEST_FLAG_KEY) === "1"
  );
}

export function writeGuestFlag(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (enabled) {
    localStorage.setItem(GUEST_FLAG_KEY, "1");
    sessionStorage.setItem(GUEST_FLAG_KEY, "1");
    return;
  }
  localStorage.removeItem(GUEST_FLAG_KEY);
  sessionStorage.removeItem(GUEST_FLAG_KEY);
}

/** 訪客模式或未登入時回傳 null — 避免寫入 Supabase */
export async function getAuthenticatedUserId(): Promise<string | null> {
  if (readGuestFlag()) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("[auth-session] getSession", error.message);
    return null;
  }
  return data.session?.user.id ?? null;
}

export function isDataUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("data:");
}

export function isHttpUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}
