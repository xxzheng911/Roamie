import type { Session } from "@supabase/supabase-js";
import { getClientAuthSession } from "@/lib/auth-session";
import { ensureUserProfile, syncProfileAppFields } from "@/lib/ensure-user-profile";

const PROFILE_ENSURE_TIMEOUT_MS = 8_000;

function scheduleProfileEnsure(userId: string): void {
  void (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await ensureUserProfile(userId);
          await syncProfileAppFields(userId);
        })(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, PROFILE_ENSURE_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      console.warn("[auth] ensure profile failed", e);
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
}

/**
 * OAuth / 原生 Apple 登入成功後：確認 session，profile 在背景建立（不阻塞導向）。
 */
export async function completeSignInAfterAuth(
  explicitUserId?: string,
  existingSession?: Session | null,
): Promise<Session> {
  const session = existingSession ?? (await getClientAuthSession());
  if (!session?.user) {
    throw new Error("登入後未取得 session");
  }

  const userId = explicitUserId ?? session.user.id;
  scheduleProfileEnsure(userId);

  return session;
}
