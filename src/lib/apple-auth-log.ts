import type { AppleAuthErrorDetail } from "@/lib/apple-auth-error";
import type { AppleIdentityTokenMeta } from "@/lib/apple-identity-token";

export const APPLE_SIGN_IN_TEMP_FAIL_MSG = "Apple 登入暫時失敗，請稍後再試";

export type AppleAuthFailurePhase =
  | "plugin_missing"
  | "supabase_config"
  | "native_authorize"
  | "no_identity_token"
  | "token_exchange"
  | "no_session"
  | "cancelled"
  | "unknown";

export type AppleAuthFailure = AppleAuthErrorDetail & {
  phase: AppleAuthFailurePhase;
  via?: string;
};

/**
 * Capacitor iOS 對 `console.info(tag, object)` 常不顯示；與 [APP_ERROR] 相同用單行 error。
 * @see src/lib/log-error.ts —「單一字串行 — Capacitor console 只可靠顯示這個」
 */
export function emitAppleAuthMarker(
  marker: string,
  detail?: Record<string, unknown>,
): void {
  if (detail && Object.keys(detail).length > 0) {
    try {
      console.error(`${marker} ${JSON.stringify(detail)}`);
    } catch {
      console.error(marker);
    }
    return;
  }
  console.error(marker);
}

export function logAppleAuthStart(fields?: Record<string, unknown>): void {
  emitAppleAuthMarker("[APPLE_AUTH_START]", {
    at: new Date().toISOString(),
    ...fields,
  });
}

export function logAppleAuthCredentialReceived(fields: {
  hasUser: boolean;
  hasEmail: boolean;
  hasAuthorizationCode: boolean;
}): void {
  emitAppleAuthMarker("[APPLE_AUTH_CREDENTIAL_RECEIVED]", fields);
}

export function logAppleAuthIdTokenReceived(
  meta: AppleIdentityTokenMeta & { normalized: boolean },
): void {
  emitAppleAuthMarker("[APPLE_AUTH_ID_TOKEN_RECEIVED]", meta);
}

export function logAppleAuthIdTokenMissing(
  meta: AppleIdentityTokenMeta & Record<string, unknown>,
): void {
  emitAppleAuthMarker("[APPLE_AUTH_ID_TOKEN_MISSING]", meta);
}

export function logAppleAuthNativeAuthorize(): void {
  emitAppleAuthMarker("[APPLE_AUTH_NATIVE_AUTHORIZE]", {
    client: "SignInWithApple.authorize",
  });
}

export function logAppleAuthTokenExchangeStart(fields: {
  host: string;
  attempt: number;
  via: "signInWithIdToken" | "http_post";
}): void {
  emitAppleAuthMarker("[APPLE_AUTH_TOKEN_EXCHANGE_START]", fields);
}

export function logAppleAuthTokenExchangeSuccess(fields: {
  ms: number;
  via: string;
  userId?: string;
}): void {
  emitAppleAuthMarker("[APPLE_AUTH_TOKEN_EXCHANGE_SUCCESS]", fields);
}

export function logAppleAuthTokenExchangeTimeout(fields: {
  ms: number;
  attempt: number;
  via: string;
}): void {
  emitAppleAuthMarker("[APPLE_AUTH_TOKEN_EXCHANGE_TIMEOUT]", fields);
}

export function logAppleAuthTokenExchangeError(
  fields: AppleAuthErrorDetail & {
    ms: number;
    attempt: number;
    via: string;
    httpStatus?: number;
  },
): void {
  emitAppleAuthMarker("[APPLE_AUTH_TOKEN_EXCHANGE_ERROR]", fields);
}

export function logAppleAuthSessionReady(userId: string | undefined): void {
  emitAppleAuthMarker("[APPLE_AUTH_SESSION_READY]", { userId: userId ?? null });
}

export function logAppleAuthNavigateHome(target: string): void {
  emitAppleAuthMarker("[APPLE_AUTH_NAVIGATE_HOME]", { target });
}

export function logAppleAuthSignInFailed(failure: AppleAuthFailure): void {
  emitAppleAuthMarker("[APPLE_AUTH_SIGN_IN_FAILED]", failure);
}
