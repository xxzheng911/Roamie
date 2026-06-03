import type { Session } from "@supabase/supabase-js";
import { APP_BUNDLE_ID } from "@/constants/app";
import { createAppleSignInNonce } from "@/lib/auth-nonce";
import { assertSupabaseConfiguredForAuth } from "@/lib/supabase-project-url";
import { logAuthDebug, logAuthError, logAuthSessionResult } from "@/lib/auth-debug";
import {
  clearPartialAppleAuthSession,
  exchangeAppleIdTokenWithSupabase,
} from "@/lib/auth-apple-supabase-token";
import {
  APPLE_SIGN_IN_TEMP_FAIL_MSG,
  logAppleAuthIdTokenReceived,
  logAppleAuthStart,
} from "@/lib/apple-auth-log";
import {
  isSupabaseConnectivityError,
  SUPABASE_UNAVAILABLE_USER_MSG,
} from "@/lib/supabase-connectivity";
import { detectPlatform } from "@/services/platform";
import { readSupabaseProjectUrl } from "@/lib/supabase-project-url";

export type AppleNativeSignInResult =
  | { ok: true; session: Session }
  | { ok: false; message: string; cancelled?: boolean };

let appleNativeSignInInflight: Promise<AppleNativeSignInResult> | null = null;

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

function mapExchangeErrorToUserMessage(detail: string, error?: unknown): string {
  if (error && isSupabaseConnectivityError(error)) {
    return SUPABASE_UNAVAILABLE_USER_MSG;
  }
  if (/apple_supabase_sign_in_timeout|逾時|timeout/i.test(detail)) {
    return APPLE_SIGN_IN_TEMP_FAIL_MSG;
  }
  if (/nonces?\s*mismatch/i.test(detail)) {
    return (
      "Apple 登入失敗：nonce 驗證不一致。請確認 Supabase Dashboard → Authentication → Apple 已啟用，" +
      "且 Client IDs 含 App bundle ID（com.shuode.roamie）。"
    );
  }
  if (/supabase_not_configured/i.test(detail)) {
    return "雲端登入未設定，請更新 App 後再試。";
  }
  return APPLE_SIGN_IN_TEMP_FAIL_MSG;
}

/**
 * iOS 原生 Sign in with Apple → Supabase session（不開 Safari OAuth）。
 */
export async function signInWithAppleNative(): Promise<AppleNativeSignInResult> {
  if (!canUseNativeAppleSignIn()) {
    return { ok: false, message: "目前裝置不支援原生 Apple 登入" };
  }

  if (appleNativeSignInInflight) {
    console.info("[APPLE_AUTH] sign_in_join_inflight");
    return appleNativeSignInInflight;
  }

  appleNativeSignInInflight = runNativeAppleSignIn().finally(() => {
    appleNativeSignInInflight = null;
  });
  return appleNativeSignInInflight;
}

async function runNativeAppleSignIn(): Promise<AppleNativeSignInResult> {
  const mod = await import("@capacitor-community/apple-sign-in").catch(() => null);
  const SignInWithApple = mod?.SignInWithApple;
  if (!SignInWithApple) {
    return { ok: false, message: "Apple 登入模組尚未就緒（請確認 iOS 原生插件已安裝）" };
  }

  const configError = assertSupabaseConfiguredForAuth();
  if (configError) {
    return { ok: false, message: configError };
  }

  logAppleAuthStart({ clientId: APP_BUNDLE_ID });
  logAuthDebug("apple.native.start", { provider: "apple", clientId: APP_BUNDLE_ID });

  try {
    const { raw: rawNonce, hashed: hashedNonce } = await createAppleSignInNonce();

    const appleResult = await SignInWithApple.authorize({
      clientId: APP_BUNDLE_ID,
      redirectURI: "",
      scopes: "email name",
      nonce: hashedNonce,
    });

    const identityToken = appleResult.response?.identityToken;
    logAppleAuthIdTokenReceived(Boolean(identityToken));
    logAuthDebug("apple.native.authorized", {
      hasIdentityToken: Boolean(identityToken),
    });

    if (!identityToken) {
      logAuthSessionResult(false, { provider: "apple", reason: "no_identity_token" });
      return { ok: false, message: "Apple 未回傳 identity token" };
    }

    const projectUrl = readSupabaseProjectUrl();
    const host = projectUrl ? new URL(projectUrl).host : "(unset)";

    const { session, error, via } = await exchangeAppleIdTokenWithSupabase(
      identityToken,
      rawNonce,
    );

    logAuthDebug("apple.native.supabase_done", {
      via,
      host,
      hasSession: Boolean(session),
      error: error?.message ?? null,
    });

    if (error) {
      logAuthError("apple.token_exchange", error);
      await clearPartialAppleAuthSession();
      return { ok: false, message: mapExchangeErrorToUserMessage(error.message, error) };
    }

    if (!session?.user) {
      await clearPartialAppleAuthSession();
      logAuthSessionResult(false, { provider: "apple", reason: "no_session" });
      return { ok: false, message: APPLE_SIGN_IN_TEMP_FAIL_MSG };
    }

    logAuthSessionResult(true, {
      provider: "apple",
      flow: "native",
      userId: session.user.id,
      email: session.user.email ?? "(hidden or none)",
      isPrivateEmail: session.user.email?.includes("@privaterelay.appleid.com") ?? false,
    });

    console.info("[APPLE_AUTH] success userId=", session.user.id);
    return { ok: true, session };
  } catch (e) {
    if (isUserCancelled(e)) {
      logAuthDebug("apple.native.cancelled", {});
      return { ok: false, message: "已取消登入", cancelled: true };
    }
    await clearPartialAppleAuthSession();
    const msg = e instanceof Error ? e.message : "Apple 登入失敗";
    logAuthError("apple.native.failed", e);
    return { ok: false, message: mapExchangeErrorToUserMessage(msg, e) };
  }
}
