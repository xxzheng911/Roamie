import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { getClientAuthSession } from "@/lib/auth-session";
import { clearAuthState } from "@/lib/clear-auth-state";
import { logAuthDebug, logAuthError, logGoogleOAuthMarker } from "@/lib/auth-debug";
import { markOAuthCodeConsumed } from "@/lib/oauth-callback-guard";
import { restoreOAuthPkceVerifier } from "@/lib/supabase-auth-storage";

/** PKCE：用 ?code= 兌換 session */
export async function exchangeOAuthCode(code: string): Promise<Session> {
  logAuthDebug("oauth.exchange_code", { codeLength: code.length });
  const restored = await restoreOAuthPkceVerifier();
  logAuthDebug("oauth.pkce_restore", { restored });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    if (/pkce|code verifier/i.test(error.message)) {
      logGoogleOAuthMarker("failed", { message: error.message, step: "exchangeCodeForSession" });
      await clearAuthState({ reason: "pkce-exchange-failed" });
    }
    throw error;
  }

  markOAuthCodeConsumed(code);

  const session = await getClientAuthSession();
  if (session) return session;

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      sub.unsubscribe();
      reject(new Error("登入後未取得 session"));
    }, 12_000);

    const {
      data: { subscription: sub },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && s) {
        window.clearTimeout(timeout);
        sub.unsubscribe();
        resolve(s);
      }
    });
  });
}

/** Implicit / hash：access_token + refresh_token（部分 redirect 設定會走 hash） */
export async function setSessionFromUrlHash(hash: URLSearchParams): Promise<Session | null> {
  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");
  if (!access_token || !refresh_token) return null;

  logAuthDebug("oauth.set_session_from_hash", {
    hasAccessToken: true,
    hasRefreshToken: true,
  });

  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (error) throw error;
  return data.session;
}

export function readOAuthErrorFromUrl(
  query: URLSearchParams,
  hash: URLSearchParams,
): string | null {
  const raw =
    query.get("error_description") ||
    query.get("error") ||
    hash.get("error_description") ||
    hash.get("error");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

export type OAuthCallbackSearch = {
  code?: string;
  error?: string;
  error_description?: string;
};

export async function resolveSessionFromCallbackUrl(
  routeSearch?: OAuthCallbackSearch,
): Promise<{
  session: Session;
  method: "code" | "hash" | "existing";
}> {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  if (routeSearch?.code && !query.has("code")) {
    query.set("code", routeSearch.code);
  }
  if (routeSearch?.error && !query.has("error")) {
    query.set("error", routeSearch.error);
  }
  if (routeSearch?.error_description && !query.has("error_description")) {
    query.set("error_description", routeSearch.error_description);
  }

  const oauthError = readOAuthErrorFromUrl(query, hash);
  if (oauthError) {
    logAuthError("oauth.provider_error", oauthError);
    throw new Error(oauthError);
  }

  const code = query.get("code");
  if (code) {
    const session = await exchangeOAuthCode(code);
    return { session, method: "code" };
  }

  const fromHash = await setSessionFromUrlHash(hash);
  if (fromHash) return { session: fromHash, method: "hash" };

  const existing = await getClientAuthSession();
  if (existing?.user) return { session: existing, method: "existing" };

  throw new Error("登入連結不完整，請重新登入。");
}
