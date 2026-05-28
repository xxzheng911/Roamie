import { CapacitorHttp } from "@capacitor/core";
import { supabase } from "@/lib/supabase";
import { isLocalhostAppApiUrl, resolveAppApiBaseUrl, resolveAppApiUrl } from "@/lib/api-base-url";
import { detectPlatform } from "@/services/platform";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { markOnboardingCompleted } from "@/lib/onboarding-storage";
import { unlockDeveloperMode } from "@/lib/access/developer";
import { ACCESS_CHANGED_EVENT } from "@/lib/access/events";
import { APP_BUILD_NUMBER, APP_MARKETING_VERSION } from "@/constants/app";
import { QA_CLIENT_BUILD_HEADER } from "./constants";
import { getOrCreateQaDeviceId } from "./device-id";
import { warmSupabaseAuthStorage } from "@/lib/supabase-auth-storage";
import { isQaBuildEnabled, qaClientBuildHeaderValue } from "./build";

function redactQaAuthResponseBody(bodyText: string | null): string | null {
  if (!bodyText) return bodyText;
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    if (!("access_token" in parsed) && !("refresh_token" in parsed)) return bodyText;
    return JSON.stringify({
      ...parsed,
      access_token: parsed.access_token ? "[redacted]" : undefined,
      refresh_token: parsed.refresh_token ? "[redacted]" : undefined,
    });
  } catch {
    return bodyText.length > 200 ? `${bodyText.slice(0, 200)}…` : bodyText;
  }
}

export type QaSignInResult = { ok: true; userId: string } | { ok: false; message: string };
const QA_PRODUCTION_ORIGIN = "https://roamie.tw";
export type QaLoginDiagnosticSnapshot = {
  step: string;
  apiBaseUrl: string | null;
  requestUrl: string | null;
  httpStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  hasSession: boolean;
  envMode: string;
  buildVersion: string;
  transport?: string | null;
  created_at: string;
};

const QA_FETCH_TIMEOUT_MS = 30_000;

function serializeHttpBody(data: unknown): string {
  if (typeof data === "string") return data;
  if (data == null) return "";
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

async function qaAuthHttpRequest(
  url: string,
  method: "GET" | "POST",
  options: {
    headers?: Record<string, string>;
    jsonBody?: Record<string, string>;
  },
): Promise<{ status: number; bodyText: string; transport: string }> {
  const useNativeHttp =
    detectPlatform().isCapacitor ||
    (typeof window !== "undefined" && window.location.protocol === "capacitor:");
  if (useNativeHttp) {
    const response = await CapacitorHttp.request({
      url,
      method,
      headers: options.headers ?? {},
      data: method === "POST" ? options.jsonBody : undefined,
      connectTimeout: QA_FETCH_TIMEOUT_MS,
      readTimeout: QA_FETCH_TIMEOUT_MS,
    });
    return {
      status: response.status,
      bodyText: serializeHttpBody(response.data),
      transport: "capacitor_http",
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), QA_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: options.headers,
      body: method === "POST" ? JSON.stringify(options.jsonBody ?? {}) : undefined,
      signal: controller.signal,
    });
    return {
      status: response.status,
      bodyText: await response.text(),
      transport: "fetch",
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function readSupabaseSessionDebug() {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    return {
      hasSession: Boolean(session),
      hasAccessToken: Boolean(session?.access_token),
      hasRefreshToken: Boolean(session?.refresh_token),
      sessionUserId: session?.user?.id ?? null,
    };
  } catch (error) {
    return {
      hasSession: false,
      hasAccessToken: false,
      hasRefreshToken: false,
      sessionUserId: null,
      sessionReadError: error instanceof Error ? error.message : String(error),
    };
  }
}

function diagnosticsBase(
  apiBaseUrl: string | null,
  requestUrl: string | null,
): Omit<
  QaLoginDiagnosticSnapshot,
  "step" | "httpStatus" | "responseBody" | "errorMessage" | "hasSession" | "created_at"
> {
  return {
    apiBaseUrl,
    requestUrl,
    envMode: import.meta.env.MODE,
    buildVersion: `${APP_MARKETING_VERSION} (${APP_BUILD_NUMBER})`,
  };
}

export async function signInAsQaTestUser(options?: {
  onDiagnostics?: (snapshot: QaLoginDiagnosticSnapshot) => void;
}): Promise<QaSignInResult> {
  if (!isQaBuildEnabled()) {
    return { ok: false, message: "QA 測試登入僅限開發 / TestFlight debug 建置" };
  }

  const deviceId = getOrCreateQaDeviceId();
  const apiBaseUrl = resolveAppApiBaseUrl();
  const requestUrl = resolveAppApiUrl("/api/qa-auth");
  const fallbackUrl = `${QA_PRODUCTION_ORIGIN}/api/qa-auth`;
  const candidateUrls = Array.from(new Set([requestUrl, fallbackUrl]));
  const emitDiagnostics = async (input: {
    step: string;
    requestUrl?: string | null;
    httpStatus?: number | null;
    responseBody?: string | null;
    errorMessage?: string | null;
    transport?: string | null;
  }) => {
    const sessionDebug = await readSupabaseSessionDebug();
    options?.onDiagnostics?.({
      ...diagnosticsBase(apiBaseUrl, input.requestUrl ?? requestUrl),
      step: input.step,
      httpStatus: input.httpStatus ?? null,
      responseBody: redactQaAuthResponseBody(input.responseBody ?? null),
      errorMessage: input.errorMessage ?? null,
      hasSession: sessionDebug.hasSession,
      transport: input.transport ?? null,
      created_at: new Date().toISOString(),
    });
  };
  await emitDiagnostics({ step: "prepare", requestUrl });
  console.info("[QA_AUTH] request prepared", {
    requestUrl,
    fallbackUrl,
    candidateUrls,
    apiBaseUrl,
    qaBuildEnabled: isQaBuildEnabled(),
    qaHeaderEnabled: Boolean(qaClientBuildHeaderValue()),
    envMode: import.meta.env.MODE,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const qaHeader = qaClientBuildHeaderValue();
  if (qaHeader) headers[QA_CLIENT_BUILD_HEADER] = qaHeader;

  if (candidateUrls.every((url) => isLocalhostAppApiUrl(url))) {
    await emitDiagnostics({
      step: "blocked_localhost",
      requestUrl,
      errorMessage: "QA API 指向 localhost",
    });
    console.error("[QA_AUTH] invalid API base URL", {
      requestUrl: candidateUrls,
      apiBaseUrl,
      hint: "Capacitor/TestFlight must use deployed https origin, not localhost",
    });
    return {
      ok: false,
      message: "QA 登入 API 目前指向 localhost，請改用已部署的 production/staging API",
    };
  }
  let healthStatus: number | null = null;
  let healthBody = "";
  let usedRequestUrl: string | null = null;
  try {
    const healthRes = await qaAuthHttpRequest(candidateUrls[0], "GET");
    healthStatus = healthRes.status;
    healthBody = healthRes.bodyText;
    await emitDiagnostics({
      step: "health_checked",
      requestUrl: candidateUrls[0],
      httpStatus: healthRes.status,
      responseBody: healthBody,
      transport: healthRes.transport,
    });
  } catch (error) {
    await emitDiagnostics({
      step: "health_failed",
      requestUrl: candidateUrls[0],
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.warn("[QA_AUTH] health check failed", {
      requestUrl: candidateUrls[0],
      apiBaseUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let postStatus: number | null = null;
  let postBody = "";
  let postTransport: string | null = null;
  let networkError: unknown = null;
  try {
    for (const url of candidateUrls) {
      if (isLocalhostAppApiUrl(url)) continue;
      await emitDiagnostics({
        step: "post_start",
        requestUrl: url,
        transport: detectPlatform().isCapacitor ? "capacitor_http" : "fetch",
      });
      try {
        const response = await qaAuthHttpRequest(url, "POST", {
          headers,
          jsonBody: { deviceId },
        });
        usedRequestUrl = url;
        postStatus = response.status;
        postBody = response.bodyText;
        postTransport = response.transport;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = error instanceof DOMException && error.name === "AbortError";
        await emitDiagnostics({
          step: isTimeout ? "post_timeout" : "request_candidate_failed",
          requestUrl: url,
          errorMessage: message,
          transport: detectPlatform().isCapacitor ? "capacitor_http" : "fetch",
        });
        networkError = error;
        console.warn("[QA_AUTH] request candidate failed", {
          requestUrl: url,
          apiBaseUrl,
          error: message,
        });
      }
    }
  } catch (error) {
    networkError = error;
  }

  if (postStatus == null) {
    await emitDiagnostics({
      step: "network_error",
      requestUrl,
      errorMessage: networkError instanceof Error ? networkError.message : String(networkError),
      transport: postTransport,
    });
    const sessionDebug = await readSupabaseSessionDebug();
    console.error("[QA_AUTH] network error", {
      requestUrl: candidateUrls,
      apiBaseUrl,
      healthStatus,
      healthBody,
      ...sessionDebug,
      error: networkError instanceof Error ? networkError.message : String(networkError),
    });
    return {
      ok: false,
      message: "無法連線到 QA 登入 API，請確認 App 使用 https://roamie.tw 並檢查手機網路/防火牆",
    };
  }

  let body: {
    error?: string;
    access_token?: string;
    refresh_token?: string;
    qa_auth_enabled?: boolean;
  } | null = null;
  const rawBody = postBody;
  try {
    body = rawBody ? (JSON.parse(rawBody) as NonNullable<typeof body>) : null;
    await emitDiagnostics({
      step: "response_received",
      requestUrl: usedRequestUrl ?? requestUrl,
      httpStatus: postStatus,
      responseBody: rawBody,
      transport: postTransport,
    });
  } catch (error) {
    await emitDiagnostics({
      step: "response_parse_error",
      requestUrl: usedRequestUrl ?? requestUrl,
      httpStatus: postStatus,
      responseBody: rawBody,
      errorMessage: error instanceof Error ? error.message : String(error),
      transport: postTransport,
    });
    const sessionDebug = await readSupabaseSessionDebug();
    console.error("[QA_AUTH] response parse error", {
      requestUrl,
      usedRequestUrl,
      apiBaseUrl,
      status: postStatus,
      responseBody: rawBody,
      healthStatus,
      healthBody,
      ...sessionDebug,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: `QA 登入失敗（HTTP ${postStatus}）` };
  }

  if (postStatus < 200 || postStatus >= 300) {
    await emitDiagnostics({
      step: "response_not_ok",
      requestUrl: usedRequestUrl ?? requestUrl,
      httpStatus: postStatus,
      responseBody: rawBody,
      errorMessage: body?.error ?? `HTTP ${postStatus}`,
      transport: postTransport,
    });
    const sessionDebug = await readSupabaseSessionDebug();
    console.error("[QA_AUTH] request failed", {
      requestUrl,
      usedRequestUrl,
      apiBaseUrl,
      status: postStatus,
      responseBody: rawBody,
      healthStatus,
      healthBody,
      qaAuthEnabledFromServer: body?.qa_auth_enabled ?? null,
      ...sessionDebug,
    });
    const errMessage = body?.error ?? `QA 登入失敗（HTTP ${postStatus}）`;
    return { ok: false, message: errMessage };
  }

  if (!body?.access_token || !body.refresh_token) {
    await emitDiagnostics({
      step: "missing_tokens",
      requestUrl: usedRequestUrl ?? requestUrl,
      httpStatus: postStatus,
      responseBody: rawBody,
      errorMessage: "伺服器未回傳有效 session",
    });
    const sessionDebug = await readSupabaseSessionDebug();
    console.error("[QA_AUTH] missing session token", {
      requestUrl,
      usedRequestUrl,
      apiBaseUrl,
      status: postStatus,
      responseBody: rawBody,
      healthStatus,
      healthBody,
      qaAuthEnabledFromServer: body?.qa_auth_enabled ?? null,
      ...sessionDebug,
    });
    return { ok: false, message: "伺服器未回傳有效 session" };
  }

  await warmSupabaseAuthStorage();
  await emitDiagnostics({ step: "set_session_start", requestUrl: usedRequestUrl ?? requestUrl });

  const { error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });

  if (error) {
    await emitDiagnostics({
      step: "set_session_failed",
      requestUrl: usedRequestUrl ?? requestUrl,
      errorMessage: error.message,
    });
    const sessionDebug = await readSupabaseSessionDebug();
    console.error("[QA_AUTH] setSession failed", {
      requestUrl,
      usedRequestUrl,
      apiBaseUrl,
      qaAuthEnabledFromServer: body?.qa_auth_enabled ?? null,
      ...sessionDebug,
      error: error.message,
    });
    return { ok: false, message: error.message };
  }

  await emitDiagnostics({
    step: "set_session_done",
    requestUrl: usedRequestUrl ?? requestUrl,
    responseBody: JSON.stringify({ userId: body.user?.id ?? null }),
  });

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
    await emitDiagnostics({
      step: "session_user_missing",
      requestUrl: usedRequestUrl ?? requestUrl,
      errorMessage: "登入後未取得使用者 ID",
    });
    return { ok: false, message: "登入後未取得使用者 ID" };
  }
  await emitDiagnostics({
    step: "success",
    requestUrl: usedRequestUrl ?? requestUrl,
    httpStatus: postStatus,
    responseBody: rawBody,
    transport: postTransport,
  });

  return { ok: true, userId };
}
