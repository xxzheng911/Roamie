import { SignInWithApple } from "@capacitor-community/apple-sign-in";
import type { Session } from "@supabase/supabase-js";
import { APP_BUNDLE_ID } from "@/constants/app";
import { createAppleSignInNonce } from "@/lib/auth-nonce";
import { assertSupabaseConfiguredForAuth } from "@/lib/supabase-project-url";
import { logAuthDebug, logAuthError, logAuthSessionResult } from "@/lib/auth-debug";
import { supabase } from "@/lib/supabase";
import { detectPlatform } from "@/services/platform";

const APPLE_SUPABASE_TIMEOUT_MS = 25_000;

export type AppleNativeSignInResult =
  | { ok: true; session: Session }
  | { ok: false; message: string; cancelled?: boolean };

export function canUseNativeAppleSignIn(): boolean {
  if (typeof window === "undefined") return false;
  const info = detectPlatform();
  return info.isIOS && info.isCapacitor;
}

function isUserCancelled(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return (
    code === "1001" ||
    /cancel/i.test(msg) ||
    /user canceled/i.test(msg) ||
    /authorization failed/i.test(msg)
  );
}

/**
 * iOS 原生 Sign in with Apple → Supabase signInWithIdToken（不開 Safari OAuth）。
 * 原生插件忽略 JS 的 redirectURI；僅 clientId / nonce 會傳入 ASAuthorizationAppleIDProvider。
 */
export async function signInWithAppleNative(): Promise<AppleNativeSignInResult> {
  if (!canUseNativeAppleSignIn()) {
    return { ok: false, message: "目前裝置不支援原生 Apple 登入" };
  }

  const configError = assertSupabaseConfiguredForAuth();
  if (configError) {
    return { ok: false, message: configError };
  }

  logAuthDebug("apple.native.start", {
    provider: "apple",
    clientId: APP_BUNDLE_ID,
  });

  try {
    const { raw: rawNonce, hashed: hashedNonce } = await createAppleSignInNonce();

    const appleResult = await SignInWithApple.authorize({
      clientId: APP_BUNDLE_ID,
      redirectURI: "",
      scopes: "email name",
      nonce: hashedNonce,
    });

    logAuthDebug("apple.native.authorized", {
      hasIdentityToken: Boolean(appleResult.response?.identityToken),
    });

    const identityToken = appleResult.response?.identityToken;
    if (!identityToken) {
      logAuthSessionResult(false, { provider: "apple", reason: "no_identity_token" });
      return { ok: false, message: "Apple 未回傳 identity token" };
    }

    const signInStartedAt = Date.now();
    const { data, error } = await Promise.race([
      supabase.auth.signInWithIdToken({
        provider: "apple",
        token: identityToken,
        nonce: rawNonce,
      }),
      new Promise<{ data: { session: null; user: null }; error: Error }>((resolve) => {
        window.setTimeout(
          () =>
            resolve({
              data: { session: null, user: null },
              error: new Error("apple_supabase_sign_in_timeout"),
            }),
          APPLE_SUPABASE_TIMEOUT_MS,
        );
      }),
    ]);

    logAuthDebug("apple.native.supabase_done", {
      ms: Date.now() - signInStartedAt,
      hasSession: Boolean(data.session),
      error: error?.message ?? null,
    });

    if (error) {
      logAuthError("apple.signInWithIdToken", error);
      const detail = error.message?.trim() || "Supabase 拒絕 Apple token";
      if (/apple_supabase_sign_in_timeout/i.test(detail)) {
        return { ok: false, message: "連線登入服務逾時，請確認網路後再試。" };
      }
      const nonceMismatch = /nonces?\s*mismatch/i.test(detail);
      if (nonceMismatch) {
        return {
          ok: false,
          message:
            "Apple 登入失敗：nonce 驗證不一致。請確認 Supabase Dashboard → Authentication → Apple 已啟用，且 Client IDs 含 App bundle ID；若仍失敗可暫開 skip nonce check（見專案 supabase/config.toml 註解）。",
        };
      }
      return {
        ok: false,
        message: `Apple 登入失敗：${detail}`,
      };
    }

    if (!data.session) {
      logAuthSessionResult(false, { provider: "apple", reason: "no_session" });
      return { ok: false, message: "Supabase 未建立 session" };
    }

    logAuthSessionResult(true, {
      provider: "apple",
      flow: "native",
      userId: data.user?.id,
      email: data.user?.email ?? "(hidden or none)",
      isPrivateEmail: data.user?.email?.includes("@privaterelay.appleid.com") ?? false,
    });

    return { ok: true, session: data.session };
  } catch (e) {
    if (isUserCancelled(e)) {
      logAuthDebug("apple.native.cancelled", {});
      return { ok: false, message: "已取消登入", cancelled: true };
    }
    logAuthError("apple.native.failed", e);
    const msg = e instanceof Error ? e.message : "Apple 登入失敗";
    return { ok: false, message: msg };
  }
}
