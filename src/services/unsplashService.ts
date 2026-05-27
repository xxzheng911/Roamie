import { cacheKey, getCachedImage, setCachedImage } from "@/services/image-cache";

const UNSPLASH_SEARCH = "https://api.unsplash.com/search/photos";

/** Unsplash 風格修飾：奶油色系、柔和、低飽和、生活感 */
const STYLE_SUFFIX = "soft pastel cinematic travel lifestyle aesthetic";

export type UnsplashSearchResult = {
  url: string;
  query: string;
  photographer?: string;
};

function accessKey(): string | null {
  const key = import.meta.env.VITE_UNSPLASH_ACCESS_KEY as string | undefined;
  return key?.trim() || null;
}

/** 搜尋 Unsplash 圖片（含 memory + localStorage 快取） */
export async function searchUnsplashImage(query: string): Promise<UnsplashSearchResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const key = cacheKey("unsplash", trimmed);
  const cached = getCachedImage(key);
  if (cached) return { url: cached, query: trimmed };

  const clientId = accessKey();
  if (!clientId) return null;

  const fullQuery = `${trimmed} ${STYLE_SUFFIX}`.trim();
  const params = new URLSearchParams({
    query: fullQuery,
    per_page: "5",
    orientation: "landscape",
    content_filter: "high",
  });

  try {
    const res = await fetch(`${UNSPLASH_SEARCH}?${params}`, {
      headers: { Authorization: `Client-ID ${clientId}` },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      results?: Array<{
        urls?: { regular?: string; small?: string };
        user?: { name?: string };
      }>;
    };

    const hit = data.results?.find((r) => r.urls?.regular || r.urls?.small);
    const url = hit?.urls?.regular ?? hit?.urls?.small;
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
