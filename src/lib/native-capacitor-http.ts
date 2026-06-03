import { CapacitorHttp } from "@capacitor/core";
import { detectPlatform } from "@/services/platform";

export function isNativeCapacitorShell(): boolean {
  if (typeof window === "undefined") return false;
  return (
    detectPlatform().isCapacitor ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "ionic:"
  );
}

export function serializeCapacitorHttpBody(data: unknown): string {
  if (typeof data === "string") return data;
  if (data == null) return "";
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export type NativeHttpResult = {
  status: number;
  bodyText: string;
  transport: "capacitor_http" | "fetch";
};

/**
 * iOS/Android Capacitor：用原生 HTTP 取代 WKWebView fetch（避免 Supabase / API 逾時卡住）。
 */
function defaultTimeoutsForUrl(url: string): { connect: number; read: number } {
  if (url.includes("/auth/v1/")) {
    return { connect: 35_000, read: 50_000 };
  }
  return { connect: 20_000, read: 25_000 };
}

/** CapacitorHttp 在 iOS 上 connectTimeout 不一定可靠，加 JS 層上限避免卡住 */
async function capacitorHttpWithJsCap(
  params: Parameters<typeof CapacitorHttp.request>[0],
  jsCapMs: number,
): Promise<Awaited<ReturnType<typeof CapacitorHttp.request>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      CapacitorHttp.request(params),
      new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(`capacitor_http_js_cap 逾時（${Math.round(jsCapMs / 1000)} 秒）`)),
          jsCapMs,
        );
      }),
    ]);
  } finally {
    if (timer) globalThis.clearTimeout(timer);
  }
}

export async function nativeHttpRequest(
  url: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  options: {
    headers?: Record<string, string>;
    jsonBody?: Record<string, unknown> | unknown[];
    connectTimeoutMs?: number;
    readTimeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<NativeHttpResult> {
  const defaults = defaultTimeoutsForUrl(url);
  const connectTimeout = options.connectTimeoutMs ?? defaults.connect;
  const readTimeout = options.readTimeoutMs ?? defaults.read;
  const jsCapMs = connectTimeout + readTimeout + 5_000;

  if (isNativeCapacitorShell()) {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const response = await capacitorHttpWithJsCap(
      {
        url,
        method,
        headers: options.headers ?? {},
        data:
          method === "GET" || method === "DELETE"
            ? undefined
            : (options.jsonBody as Record<string, unknown> | undefined),
        connectTimeout,
        readTimeout,
      },
      jsCapMs,
    );

    return {
      status: response.status,
      bodyText: serializeCapacitorHttpBody(response.data),
      transport: "capacitor_http",
    };
  }

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), readTimeout);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(url, {
      method,
      headers: options.headers,
      body:
        method === "GET" || method === "DELETE"
          ? undefined
          : JSON.stringify(options.jsonBody ?? {}),
      signal: options.signal ?? controller.signal,
    });
    return {
      status: res.status,
      bodyText: await res.text(),
      transport: "fetch",
    };
  } finally {
    globalThis.clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** 供 @supabase/supabase-js `global.fetch` 使用 */
export function createCapacitorSupabaseFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isNativeCapacitorShell()) {
      return fetch(input, init);
    }

    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }

    const httpMethod = (init?.method ?? "GET").toUpperCase() as
      | "GET"
      | "POST"
      | "PUT"
      | "PATCH"
      | "DELETE";

    let jsonBody: Record<string, unknown> | undefined;
    if (init?.body && httpMethod !== "GET" && httpMethod !== "DELETE") {
      const raw = typeof init.body === "string" ? init.body : "";
      if (raw) {
        try {
          jsonBody = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          jsonBody = { _raw: raw };
        }
      }
    }

    const result = await nativeHttpRequest(url, httpMethod, {
      headers,
      jsonBody,
      signal: init?.signal ?? undefined,
    });

    return new Response(result.bodyText, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  };
}
