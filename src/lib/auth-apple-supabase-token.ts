import type { Session } from "@supabase/supabase-js";
import { readSupabaseProjectUrl } from "@/lib/supabase-project-url";
import { supabase } from "@/lib/supabase";
import { clearAuthMemoryCache } from "@/lib/supabase-auth-storage";
import { warmSupabaseAuthStorage } from "@/lib/supabase-auth-storage";
import { waitForCapacitorBridge } from "@/lib/capacitor-bridge-ready";
import { nativeHttpRequest } from "@/lib/native-capacitor-http";
import { detectPlatform } from "@/services/platform";
import { describeAuthError } from "@/lib/apple-auth-error";
import {
  logAppleAuthTokenExchangeError,
  logAppleAuthTokenExchangeStart,
  logAppleAuthTokenExchangeSuccess,
  logAppleAuthTokenExchangeTimeout,
  logAppleAuthSessionReady,
} from "@/lib/apple-auth-log";
import { readSupabaseEnvForClient } from "@/lib/supabase-env";

/** 單次 exchange 上限（含最多 2 次嘗試） */
const EXCHANGE_JS_TIMEOUT_MS = 55_000;
const AUTH_CONNECT_MS = 35_000;
const AUTH_READ_MS = 50_000;

let exchangeInflight: Promise<{
  session: Session | null;
  error: Error | null;
  via: string;
}> | null = null;

function readAnonKey(): string | null {
  return readSupabaseEnvForClient().key ?? null;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
  msg?: string;
};

function parseTokenBody(bodyText: string): TokenResponse {
  try {
    return JSON.parse(bodyText) as TokenResponse;
  } catch {
    return { error: "invalid_json", msg: bodyText.slice(0, 200) };
  }
}

function isRetryableExchangeError(message: string): boolean {
  return /timeout|timed out|逾時|abort|network|failed to fetch|could not connect|1001|-1001|-1004|1009/i.test(
    message,
  );
}

/** 逾時或失敗時清除半套 session，不寫入不完整登入狀態 */
export async function clearPartialAppleAuthSession(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* ignore */
  }
  clearAuthMemoryCache();
}

/**
 * Apple identity token → Supabase session（最多 2 次、單一 inflight）。
 */
export async function exchangeAppleIdTokenWithSupabase(
  identityToken: string,
  rawNonce: string,
): Promise<{ session: Session | null; error: Error | null; via: string }> {
  if (exchangeInflight) {
    void import("@/lib/apple-auth-log").then(({ emitAppleAuthMarker }) => {
      emitAppleAuthMarker("[APPLE_AUTH_EXCHANGE_JOIN_INFLIGHT]");
    });
    return exchangeInflight;
  }

  exchangeInflight = runTokenExchange(identityToken, rawNonce).finally(() => {
    exchangeInflight = null;
  });
  return exchangeInflight;
}

async function runTokenExchange(
  identityToken: string,
  rawNonce: string,
): Promise<{ session: Session | null; error: Error | null; via: string }> {
  const baseUrl = readSupabaseProjectUrl();
  const anonKey = readAnonKey();
  if (!baseUrl || !anonKey) {
    return {
      session: null,
      error: new Error("supabase_not_configured"),
      via: "none",
    };
  }

  if (detectPlatform().isCapacitor) {
    await waitForCapacitorBridge(8_000);
    await warmSupabaseAuthStorage();
  }

  const host = new URL(baseUrl).host;

  const attempt1 = await exchangeOnce(identityToken, rawNonce, {
    host,
    baseUrl,
    anonKey,
    attempt: 1,
    preferClient: true,
  });
  if (attempt1.session) return attempt1;

  if (attempt1.error && isRetryableExchangeError(attempt1.error.message)) {
    await clearPartialAppleAuthSession();
    const attempt2 = await exchangeOnce(identityToken, rawNonce, {
      host,
      baseUrl,
      anonKey,
      attempt: 2,
      preferClient: false,
    });
    if (!attempt2.session && attempt2.error) {
      await clearPartialAppleAuthSession();
    }
    return attempt2;
  }

  if (attempt1.error) {
    await clearPartialAppleAuthSession();
  }
  return attempt1;
}

async function exchangeOnce(
  identityToken: string,
  rawNonce: string,
  ctx: {
    host: string;
    baseUrl: string;
    anonKey: string;
    attempt: number;
    preferClient: boolean;
  },
): Promise<{ session: Session | null; error: Error | null; via: string }> {
  const via = ctx.preferClient ? "signInWithIdToken" : "http_post";
  logAppleAuthTokenExchangeStart({ host: ctx.host, attempt: ctx.attempt, via });
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  try {
    const result = await withJsTimeout(
      ctx.preferClient
        ? signInWithIdTokenOnce(identityToken, rawNonce)
        : postTokenHttpOnce(ctx.baseUrl, ctx.anonKey, identityToken, rawNonce),
      EXCHANGE_JS_TIMEOUT_MS,
      "apple_token_exchange",
    );

    if (result.session) {
      logAppleAuthTokenExchangeSuccess({
        ms: elapsed(),
        via: result.via,
        userId: result.session.user?.id,
      });
      logAppleAuthSessionReady(result.session.user?.id);
      return result;
    }

    const detail = describeAuthError(result.error);
    const msg = detail.message;
    if (/timeout|逾時|apple_supabase_sign_in_timeout/i.test(msg)) {
      logAppleAuthTokenExchangeTimeout({
        ms: elapsed(),
        attempt: ctx.attempt,
        via: result.via,
      });
      return {
        session: null,
        error: new Error("apple_supabase_sign_in_timeout"),
        via: result.via,
      };
    }

    logAppleAuthTokenExchangeError({
      ms: elapsed(),
      attempt: ctx.attempt,
      via: result.via,
      ...detail,
      httpStatus: result.httpStatus,
    });
    return { session: null, error: result.error ?? new Error(msg), via: result.via };
  } catch (e) {
    const detail = describeAuthError(e);
    const msg = detail.message;
    if (/timeout|逾時/i.test(msg)) {
      logAppleAuthTokenExchangeTimeout({
        ms: elapsed(),
        attempt: ctx.attempt,
        via,
      });
      return {
        session: null,
        error: new Error("apple_supabase_sign_in_timeout"),
        via,
      };
    }
    logAppleAuthTokenExchangeError({
      ms: elapsed(),
      attempt: ctx.attempt,
      via,
      ...detail,
    });
    return {
      session: null,
      error: e instanceof Error ? e : new Error(msg),
      via,
    };
  }
}

async function withJsTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(`${label} 逾時（${Math.round(ms / 1000)} 秒）`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) globalThis.clearTimeout(timer);
  }
}

/** 官方 client：provider apple + token + nonce（走 global CapacitorHttp fetch） */
async function signInWithIdTokenOnce(
  identityToken: string,
  rawNonce: string,
): Promise<{
  session: Session | null;
  error: Error | null;
  via: string;
  httpStatus?: number;
}> {
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: identityToken,
    nonce: rawNonce,
  });

  if (error) {
    return { session: null, error, via: "signInWithIdToken", httpStatus: (error as { status?: number }).status };
  }
  if (!data.session) {
    return { session: null, error: new Error("no_session"), via: "signInWithIdToken" };
  }
  return { session: data.session, error: null, via: "signInWithIdToken" };
}

/** 備援：直接 POST /auth/v1/token（與 GoTrue 相同欄位） */
async function postTokenHttpOnce(
  baseUrl: string,
  anonKey: string,
  identityToken: string,
  rawNonce: string,
): Promise<{
  session: Session | null;
  error: Error | null;
  via: string;
  httpStatus?: number;
}> {
  const url = `${baseUrl}/auth/v1/token?grant_type=id_token`;
  const http = await nativeHttpRequest(url, "POST", {
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    jsonBody: {
      grant_type: "id_token",
      provider: "apple",
      id_token: identityToken,
      nonce: rawNonce,
    },
    connectTimeoutMs: AUTH_CONNECT_MS,
    readTimeoutMs: AUTH_READ_MS,
  });

  const body = parseTokenBody(http.bodyText);
  if (http.status < 200 || http.status >= 300) {
    const detail =
      body.error_description || body.msg || body.error || `HTTP ${http.status}`;
    const err = new Error(detail) as Error & { status?: number; code?: string };
    err.status = http.status;
    if (typeof body.error === "string") err.code = body.error;
    return { session: null, error: err, via: "http_post", httpStatus: http.status };
  }

  if (!body.access_token || !body.refresh_token) {
    return {
      session: null,
      error: new Error("token_response_missing_session"),
      via: "http_post",
    };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });

  if (error) {
    return { session: null, error, via: "http_post" };
  }
  return { session: data.session, error: null, via: "http_post" };
}
