import { getClientAuthSession } from "@/lib/auth-session";
import { logAuthDebug } from "@/lib/auth-debug";
import { clearPendingCallbackPath, readPendingCallbackPath } from "@/lib/auth-oauth-deep-link";

const OAUTH_CODE_CONSUMED_KEY = "roamie:oauth-code-consumed";

function readConsumedCode(): string | null {
  try {
    return sessionStorage.getItem(OAUTH_CODE_CONSUMED_KEY);
  } catch {
    return null;
  }
}

export function markOAuthCodeConsumed(code: string): void {
  try {
    sessionStorage.setItem(OAUTH_CODE_CONSUMED_KEY, code);
  } catch {
    // ignore
  }
}

export function clearOAuthCodeConsumedMarker(): void {
  try {
    sessionStorage.removeItem(OAUTH_CODE_CONSUMED_KEY);
  } catch {
    // ignore
  }
}

export function extractOAuthCodeFromPath(path: string): string | null {
  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://localhost";
    return new URL(path, origin).searchParams.get("code");
  } catch {
    return null;
  }
}

export function isOAuthCodeAlreadyConsumed(code: string): boolean {
  return readConsumedCode() === code;
}

/** 已有 session 或 code 已兌換過 → 勿再進 /auth/callback（避免 PKCE verifier not found） */
export async function shouldSkipOAuthCallbackNavigation(path: string): Promise<boolean> {
  const code = extractOAuthCodeFromPath(path);
  if (code && isOAuthCodeAlreadyConsumed(code)) {
    logAuthDebug("oauth.callback_skipped", { reason: "code_already_consumed", codeLength: code.length });
    clearPendingCallbackPath();
    return true;
  }

  const session = await getClientAuthSession();
  if (session?.user) {
    logAuthDebug("oauth.callback_skipped", {
      reason: "session_already_present",
      userId: session.user.id,
      hasCode: Boolean(code),
    });
    clearPendingCallbackPath();
    return true;
  }

  return false;
}

export function readPendingOAuthCallbackPath(): string | null {
  return readPendingCallbackPath();
}
