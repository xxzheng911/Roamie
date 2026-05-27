import { supabase } from "@/lib/supabase";
import { resolveAppApiUrl } from "@/lib/api-base-url";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { markOnboardingCompleted } from "@/lib/onboarding-storage";
import { unlockDeveloperMode } from "@/lib/access/developer";
import { ACCESS_CHANGED_EVENT } from "@/lib/access/events";
import { QA_CLIENT_BUILD_HEADER } from "./constants";
import { getOrCreateQaDeviceId } from "./device-id";
import { isQaBuildEnabled, qaClientBuildHeaderValue } from "./build";

export type QaSignInResult =
  | { ok: true; userId: string }
  | { ok: false; message: string };

export async function signInAsQaTestUser(): Promise<QaSignInResult> {
  if (!isQaBuildEnabled()) {
    return { ok: false, message: "QA 測試登入僅限開發 / TestFlight debug 建置" };
  }

  const deviceId = getOrCreateQaDeviceId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const qaHeader = qaClientBuildHeaderValue();
  if (qaHeader) headers[QA_CLIENT_BUILD_HEADER] = qaHeader;

  let res: Response;
  try {
    res = await fetch(resolveAppApiUrl("/api/qa-auth"), {
      method: "POST",
      headers,
      body: JSON.stringify({ deviceId }),
    });
  } catch {
    return { ok: false, message: "無法連線到 QA 登入 API，請確認已部署且 ROAMIE_QA_AUTH_ENABLED=1" };
  }

  let body: {
    error?: string;
    access_token?: string;
    refresh_token?: string;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, message: `QA 登入失敗（HTTP ${res.status}）` };
  }

  if (!res.ok) {
    return { ok: false, message: body.error ?? `QA 登入失敗（HTTP ${res.status}）` };
  }

  if (!body.access_token || !body.refresh_token) {
    return { ok: false, message: "伺服器未回傳有效 session" };
  }

  const { error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  await markOnboardingCompleted();
  unlockDeveloperMode();
  window.dispatchEvent(new CustomEvent(ACCESS_CHANGED_EVENT));

  try {
    await ensureUserProfile();
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;
    if (userId) {
      await supabase
        .from("profiles")
        .update({
          display_name: "QA 測試帳號",
          bio: "開發／QA 測試用，不含真實個資",
          avatar_url: null,
        })
        .eq("id", userId);
    }
  } catch {
    /* profile 可稍後補齊 */
  }

  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) {
    return { ok: false, message: "登入後未取得使用者 ID" };
  }

  return { ok: true, userId };
}
