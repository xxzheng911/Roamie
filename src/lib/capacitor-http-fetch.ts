import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

export type HttpFetchResult = {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
  json: <T>() => Promise<T>;
};

/** Native shell bypasses WKWebView CORS (Directions API JSON rejects capacitor:// fetch). */
export async function fetchHttp(url: string, init?: RequestInit): Promise<HttpFetchResult> {
  if (isCapacitorNativeShell()) {
    const { CapacitorHttp } = await import("@capacitor/core");
    const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) headers[key] = value;
      } else {
        Object.assign(headers, init.headers);
      }
    }

    let data: unknown;
    if (init?.body && typeof init.body === "string") {
      try {
        data = JSON.parse(init.body);
      } catch {
        data = init.body;
      }
    }

    const response = await CapacitorHttp.request({
      url,
      method,
      headers,
      data,
      connectTimeout: 15_000,
      readTimeout: 15_000,
    });

    const bodyText =
      typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? {});

    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      text: async () => bodyText,
      json: async <T>() =>
        (typeof response.data === "object" && response.data != null
          ? response.data
          : JSON.parse(bodyText)) as T,
    };
  }

  const res = await fetch(url, init);
  return {
    status: res.status,
    ok: res.ok,
    text: () => res.text(),
    json: async <T>() => (await res.json()) as T,
  };
}
