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
  describeAuthError,
  mapAppleExchangeErrorToUserMessage,
} from "@/lib/apple-auth-error";
import {
  APPLE_SIGN_IN_TEMP_FAIL_MSG,
  logAppleAuthCredentialReceived,
  logAppleAuthIdTokenMissing,
  logAppleAuthIdTokenReceived,
  logAppleAuthNativeAuthorize,
  logAppleAuthSignInFailed,
  logAppleAuthStart,
  type AppleAuthFailure,
} from "@/lib/apple-auth-log";
import {
  describeAppleIdentityTokenInput,
  normalizeAppleIdentityToken,
} from "@/lib/apple-identity-token";
import {
  isSupabaseConnectivityError,
  isSupabaseHostnameUnreachableError,
  SUPABASE_HOST_UNREACHABLE_MSG,
  SUPABASE_UNAVAILABLE_USER_MSG,
} from "@/lib/supabase-connectivity";
import { detectPlatform } from "@/services/platform";
import {
  diagnoseSupabaseUrlForNativeBuild,
  readSupabaseProjectHost,
  readSupabaseProjectUrl,
} from "@/lib/supabase-project-url";

export type AppleNativeSignInResult =
  | { ok: true; session: Session }
  | { ok: false; message: string; cancelled?: boolean; failure?: AppleAuthFailure };

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

function userMessageForFailure(
  detail: ReturnType<typeof describeAuthError>,
  error?: unknown,
): string {
  if (diagnoseSupabaseUrlForNativeBuild()) {
    return SUPABASE_HOST_UNREACHABLE_MSG;
  }
  if (error && isSupabaseHostnameUnreachableError(error)) {
    return SUPABASE_HOST_UNREACHABLE_MSG;
  }
  if (error && isSupabaseConnectivityError(error)) {
    return SUPABASE_UNAVAILABLE_USER_MSG;
  }
  return mapAppleExchangeErrorToUserMessage(detail, error);
}

function fail(
  phase: AppleAuthFailure["phase"],
  message: string,
  extra: Partial<AppleAuthFailure> = {},
  error?: unknown,
): AppleNativeSignInResult {
  const detail = describeAuthError(error ?? { message });
  const failure: AppleAuthFailure = {
    phase,
    message: extra.message ?? detail.message ?? message,
    code: extra.code ?? detail.code,
    status: extra.status ?? detail.status,
    name: extra.name ?? detail.name,
    via: extra.via,
  };
  logAppleAuthSignInFailed(failure);
  return {
    ok: false,
    message: userMessageForFailure(failure, error) || message,
    failure,
  };
}

/**
 * iOS 原生 Sign in with Apple → Supabase session（不開 Safari OAuth）。
 */
export async function signInWithAppleNative(): Promise<AppleNativeSignInResult> {
  if (!canUseNativeAppleSignIn()) {
    return fail("unknown", "目前裝置不支援原生 Apple 登入", { code: "unsupported_platform" });
  }

  if (appleNativeSignInInflight) {
    void import("@/lib/apple-auth-log").then(({ emitAppleAuthMarker }) => {
      emitAppleAuthMarker("[APPLE_AUTH_SIGN_IN_JOIN_INFLIGHT]");
    });
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
    return fail("plugin_missing", "Apple 登入模組尚未就緒（請確認 iOS 原生插件已安裝）", {
      code: "apple_plugin_missing",
    });
  }

  const configError = assertSupabaseConfiguredForAuth();
  if (configError) {
    return fail("supabase_config", configError, { code: "supabase_not_configured" });
  }

  const supabaseHost = readSupabaseProjectHost();
  const urlIssue = diagnoseSupabaseUrlForNativeBuild();
  logAppleAuthStart({
    clientId: APP_BUNDLE_ID,
    supabaseHost: supabaseHost ?? "(unset)",
    supabaseUrlIssue: urlIssue,
  });
  if (urlIssue) {
    return fail("supabase_config", SUPABASE_HOST_UNREACHABLE_MSG, {
      code: urlIssue,
    });
  }
  logAuthDebug("apple.native.start", { provider: "apple", clientId: APP_BUNDLE_ID });

  try {
    const { raw: rawNonce, hashed: hashedNonce } = await createAppleSignInNonce();

    logAppleAuthNativeAuthorize();
    const appleResult = await SignInWithApple.authorize({
      clientId: APP_BUNDLE_ID,
      redirectURI: "",
      scopes: "email name",
      nonce: hashedNonce,
    });

    const response = appleResult.response;
    logAppleAuthCredentialReceived({
      hasUser: Boolean(response?.user),
      hasEmail: Boolean(response?.email),
      hasAuthorizationCode: Boolean(response?.authorizationCode),
    });
    logAuthDebug("apple.native.authorized", {
      hasUser: Boolean(response?.user),
      hasEmail: Boolean(response?.email),
      hasAuthorizationCode: Boolean(response?.authorizationCode),
    });

    const rawIdentityToken = response?.identityToken;
    const normalized = normalizeAppleIdentityToken(rawIdentityToken);

    if (normalized.ok) {
      logAppleAuthIdTokenReceived({ ...normalized.meta, normalized: true });
    } else {
      logAppleAuthIdTokenMissing({
        ...describeAppleIdentityTokenInput(rawIdentityToken),
        normalized: false,
      });
      logAuthSessionResult(false, { provider: "apple", reason: "no_identity_token" });
      return fail("no_identity_token", "Apple 未回傳 identity token", {
        code: "APPLE_AUTH_ID_TOKEN_MISSING",
      });
    }

    const identityToken = normalized.token;
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
      errorCode: (error as { code?: string })?.code ?? null,
    });

    if (error) {
      const detail = describeAuthError(error);
      logAuthError("apple.token_exchange", error, { via, ...detail });
      await clearPartialAppleAuthSession();
      const failure: AppleAuthFailure = { phase: "token_exchange", ...detail, via };
      logAppleAuthSignInFailed(failure);
      return {
        ok: false,
        message: userMessageForFailure(detail, error),
        failure,
      };
    }

    if (!session?.user) {
      await clearPartialAppleAuthSession();
      logAuthSessionResult(false, { provider: "apple", reason: "no_session" });
      return fail("no_session", APPLE_SIGN_IN_TEMP_FAIL_MSG, {
        code: "no_session",
        via,
      });
    }

    logAuthSessionResult(true, {
      provider: "apple",
      flow: "native",
      userId: session.user.id,
      email: session.user.email ?? "(hidden or none)",
      isPrivateEmail: session.user.email?.includes("@privaterelay.appleid.com") ?? false,
    });

    const { emitAppleAuthMarker } = await import("@/lib/apple-auth-log");
    emitAppleAuthMarker("[APPLE_AUTH_NATIVE_SUCCESS]", { userId: session.user.id });
    return { ok: true, session };
  } catch (e) {
    if (isUserCancelled(e)) {
      logAuthDebug("apple.native.cancelled", {});
      return { ok: false, message: "已取消登入", cancelled: true, failure: { phase: "cancelled", message: "cancelled" } };
    }
    await clearPartialAppleAuthSession();
    const detail = describeAuthError(e);
    logAuthError("apple.native.failed", e, detail);
    return fail("native_authorize", userMessageForFailure(detail, e), {
      ...detail,
      code: detail.code ?? (e as { code?: string })?.code,
    }, e);
  }
}
