import { supabase } from "@/integrations/supabase/client";
import { resolveApiUrl } from "@/lib/api-url";
import { preferJpegPngImageUrl } from "@/lib/safe-image-url";
import { cacheKey, getCachedImage, setCachedImage } from "@/services/image-cache";

import { coverDiagnostic, type CoverDiagnostic } from "@/services/cover-diagnostics";

const UNSPLASH_PROXY_PATH = "/api/unsplash";

/** Unsplash 風格修飾：奶油色系、柔和、低飽和、生活感 */
const STYLE_SUFFIX = "soft pastel cinematic travel lifestyle aesthetic";

export type UnsplashSearchResult = {
  url: string;
  query: string;
  photographer?: string;
};

export type UnsplashSearchClient = {
  getAccessToken: () => Promise<string | null>;
  fetchImpl: typeof fetch;
  resolveUrl: (path: string) => string;
};

async function readSessionAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token?.trim() || null;
  } catch {
    return null;
  }
}

export const unsplashSearchClient: UnsplashSearchClient = {
  getAccessToken: readSessionAccessToken,
  fetchImpl: (input, init) => fetch(input, init),
  resolveUrl: (path) => resolveApiUrl(path),
};

export const UNSPLASH_CLIENT_TIMEOUT_MS = 10_000;
type SearchOutcome = { kind: "hit"; result: UnsplashSearchResult } | { kind: "empty" | "stop" };
type SearchOptions = { style?: boolean; diagnostic?: Pick<CoverDiagnostic, "query_stage" | "attempt_index"> };

async function searchOutcome(query: string, options: SearchOptions = {}): Promise<SearchOutcome> {
  const report = (event: CoverDiagnostic) => { if (options.diagnostic) coverDiagnostic({ ...options.diagnostic, ...event }); };
  const trimmed = query.trim();
  if (!trimmed) return { kind: "empty" };
  const fullQuery = options.style === false ? trimmed : `${trimmed} ${STYLE_SUFFIX}`.trim();
  // Plain cover queries must not collide with the historical styled-query cache.
  const key = cacheKey(options.style === false ? "unsplash-cover-v2" : "unsplash", trimmed);
  const cached = getCachedImage(key);
  if (cached) { report({ cache_hit: true, cached_source: "unsplash" }); return { kind: "hit", result: { url: cached, query: trimmed } }; }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    // Race includes session lookup and JSON parsing, even if a dependency ignores abort.
    return await Promise.race([
      (async (): Promise<SearchOutcome> => {
        const token = await unsplashSearchClient.getAccessToken();
        if (controller.signal.aborted) return { kind: "stop" };
        if (!token) { report({ fallback_reason: "auth", http_status_class: "none" }); return { kind: "stop" }; }
        const res = await unsplashSearchClient.fetchImpl(unsplashSearchClient.resolveUrl(UNSPLASH_PROXY_PATH), {
          method: "POST", signal: controller.signal,
          headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: fullQuery, per_page: 5, orientation: "landscape", content_filter: "high" }),
        });
        if (controller.signal.aborted) return { kind: "stop" };
        report({ http_status_class: res.status >= 200 && res.status < 300 ? "2xx" : res.status >= 400 && res.status < 500 ? "4xx" : res.status >= 500 && res.status < 600 ? "5xx" : "other" });
        if (!res.ok) {
          report({ fallback_reason: res.status === 429 ? "rate_limited" : res.status === 401 || res.status === 403 ? "auth" : "http_error" });
          return { kind: "stop" };
        }
        let data: unknown;
        try { data = await res.json(); } catch { report({ fallback_reason: "malformed" }); return { kind: "stop" }; }
        if (controller.signal.aborted) return { kind: "stop" };
        const results = (data as { results?: unknown } | null)?.results;
        if (!Array.isArray(results)) { report({ fallback_reason: "malformed" }); return { kind: "stop" }; }
        report({ result_count_bucket: results.length === 0 ? "0" : results.length === 1 ? "1" : results.length <= 5 ? "2-5" : "6+" });
        for (const item of results.slice(0, 5)) {
          const hit = item as { urls?: { regular?: unknown; small?: unknown }; user?: { name?: unknown } } | null;
          for (const raw of [hit?.urls?.regular, hit?.urls?.small]) {
            if (typeof raw !== "string" || !raw.trim()) continue;
            const url = preferJpegPngImageUrl(raw);
            if (!url) { report({ candidate_rejected: true }); continue; }
            report({ candidate_accepted: true });
            setCachedImage(key, url);
            return { kind: "hit", result: { url, query: trimmed, ...(typeof hit?.user?.name === "string" ? { photographer: hit.user.name } : {}) } };
          }
        }
        report({ fallback_reason: results.length ? "unusable_url" : "empty" });
        return { kind: "empty" };
      })(),
      new Promise<SearchOutcome>(resolve => {
        timer = setTimeout(() => { timedOut = true; controller.abort(); resolve({ kind: "stop" }); }, UNSPLASH_CLIENT_TIMEOUT_MS);
      }),
    ]);
  } catch { report({ fallback_reason: "network", http_status_class: "none" }); return { kind: "stop" }; }
  finally { if (timer) clearTimeout(timer); if (timedOut) report({ fallback_reason: "timeout", http_status_class: "none" }); }
}

/** Legacy place-image callers retain their public result shape and query styling. */
export async function searchUnsplashImage(query: string): Promise<UnsplashSearchResult | null> {
  const result = await searchOutcome(query);
  return result.kind === "hit" ? result.result : null;
}

export type CoverQuery = { stage: "native" | "canonical" | "generic"; query: string };
export async function searchUnsplashCoverQueries(queries: CoverQuery[]): Promise<UnsplashSearchResult | null> {
  const seen = new Set<string>();
  let attempts = 0;
  for (const { stage, query } of queries) {
    const normalized = query.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    if (attempts >= 3) break;
    attempts++;
    const result = await searchOutcome(query, { style: false, diagnostic: { query_stage: stage, attempt_index: attempts as 1 | 2 | 3 } });
    if (result.kind === "hit") return result.result;
    if (result.kind === "stop") return null;
  }
  return null;
}

/** 依序嘗試多個 query，回傳第一個命中 */
export async function searchUnsplashWithQueries(
  queries: string[],
): Promise<UnsplashSearchResult | null> {
  for (const q of queries) {
    const hit = await searchUnsplashImage(q);
    if (hit) return hit;
  }
  return null;
}
