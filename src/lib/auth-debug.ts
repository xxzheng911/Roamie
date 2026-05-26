import {
  AUTH_CALLBACK_PATH,
  getOAuthRedirectUrl,
} from "@/lib/auth-redirect";
import { logAppError } from "@/lib/log-error";
import {
  OAUTH_DEEP_LINK_REDIRECT,
  suggestedSupabaseRedirectUrls,
} from "@/constants/auth-redirect";
import { detectPlatform } from "@/services/platform";
import type { OAuthProvider } from "@/constants/auth";

export type AuthDebugPayload = Record<string, unknown>;

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["code", "access_token", "refresh_token"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "[redacted]");
    }
    if (u.hash) {
      u.hash = u.hash.replace(/access_token=[^&]+/g, "access_token=[redacted]");
      u.hash = u.hash.replace(/refresh_token=[^&]+/g, "refresh_token=[redacted]");
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** 結構化 OAuth / session debug（不含完整 token）— Release 預設靜默 */
export function logAuthDebug(
  phase: string,
  payload: AuthDebugPayload = {},
): void {
  if (!import.meta.env.DEV && !isAuthDebugEnabled()) return;
  const platform = detectPlatform();
  console.info(`[auth] ${phase}`, {
    ...payload,
    platform: platform.kind,
    isCapacitor: platform.isCapacitor,
    isIOS: platform.isIOS,
  });
}

function isAuthDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("roamie:auth-debug") === "1";
  } catch {
    return false;
  }
}

export function logAuthStart(provider: OAuthProvider): void {
  const redirectTo = getOAuthRedirectUrl();
  const callbackPath =
    typeof window !== "undefined"
      ? `${window.location.origin}${AUTH_CALLBACK_PATH}`
      : AUTH_CALLBACK_PATH;

  logAuthDebug("oauth.start", {
    provider,
    redirectTo,
    deepLinkRedirect: OAUTH_DEEP_LINK_REDIRECT,
    callbackUrl: callbackPath,
    supabaseRedirectAllowList: suggestedSupabaseRedirectUrls(),
    origin: typeof window !== "undefined" ? window.location.origin : "(ssr)",
    href: typeof window !== "undefined" ? redactUrl(window.location.href) : null,
  });
}

export function logAuthAuthorizeUrl(provider: OAuthProvider, url: string): void {
  logAuthDebug("oauth.authorize_url", {
    provider,
    url: redactUrl(url),
  });
}

export function logAuthCallbackOpened(): void {
  logAuthDebug("oauth.callback_opened", {
    href: typeof window !== "undefined" ? redactUrl(window.location.href) : null,
    hasCode: typeof window !== "undefined" && new URL(window.location.href).searchParams.has("code"),
    hasHashToken:
      typeof window !== "undefined" &&
      (window.location.hash.includes("access_token") ||
        window.location.hash.includes("error")),
  });
}

export function logAuthSessionResult(
  ok: boolean,
  detail: AuthDebugPayload = {},
): void {
  logAuthDebug(ok ? "session.ok" : "session.failed", detail);
}

export function logAuthError(
  phase: string,
  error: unknown,
  extra: AuthDebugPayload = {},
): void {
  logAppError(`[auth] ${phase}`, error, {
    ...extra,
    href: typeof window !== "undefined" ? redactUrl(window.location.href) : null,
  });
}

export const OAUTH_FLOW_EVENT = "roamie:oauth-flow";

export type OAuthFlowDetail =
  | { phase: "return"; path: string }
  | { phase: "cancelled" }
  | { phase: "error"; message: string };

export function emitOAuthFlow(detail: OAuthFlowDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OAUTH_FLOW_EVENT, { detail }));
}
