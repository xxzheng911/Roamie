import type { Session } from "@supabase/supabase-js";
import { getClientAuthSession } from "@/lib/auth-session";
import { ensureUserProfile, syncProfileAppFields } from "@/lib/ensure-user-profile";

/**
 * OAuth / 原生 Apple 登入成功後：建立 profile、合併訪客資料。
 * Session 已由 Supabase client 寫入 storage；onAuthStateChange 會同步 UI。
 */
export async function completeSignInAfterAuth(explicitUserId?: string): Promise<Session> {
  const session = await getClientAuthSession();
  if (!session?.user) {
    throw new Error("登入後未取得 session");
  }

  const userId = explicitUserId ?? session.user.id;

  try {
    await ensureUserProfile(userId);
    await syncProfileAppFields(userId);
  } catch (e) {
    console.warn("[auth] ensure profile failed", e);
  }

  return session;
}
