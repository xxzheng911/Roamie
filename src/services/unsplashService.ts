import { supabase } from "@/integrations/supabase/client";
import { resolveApiUrl } from "@/lib/api-url";
import { preferJpegPngImageUrl } from "@/lib/safe-image-url";
import { cacheKey, getCachedImage, setCachedImage } from "@/services/image-cache";

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

/** 搜尋 Unsplash 圖片（含 memory + localStorage 快取） */
export async function searchUnsplashImage(query: string): Promise<UnsplashSearchResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const key = cacheKey("unsplash", trimmed);
  const cached = getCachedImage(key);
  if (cached) return { url: cached, query: trimmed };

  const token = await unsplashSearchClient.getAccessToken();
  if (!token) return null;

  const fullQuery = `${trimmed} ${STYLE_SUFFIX}`.trim();
  try {
    const res = await unsplashSearchClient.fetchImpl(
      unsplashSearchClient.resolveUrl(UNSPLASH_PROXY_PATH),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: fullQuery,
          per_page: 5,
          orientation: "landscape",
          content_filter: "high",
        }),
      },
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      results?: Array<{
        urls?: { regular?: string; small?: string };
        user?: { name?: string };
      }>;
    };

    const hit = data.results?.find((r) => r.urls?.regular || r.urls?.small);
    const rawUrl = hit?.urls?.regular ?? hit?.urls?.small;
    const url = rawUrl ? preferJpegPngImageUrl(rawUrl) : null;
    if (!url) return null;

    setCachedImage(key, url);
    return { url, query: trimmed, photographer: hit?.user?.name };
  } catch {
    return null;
  }
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
