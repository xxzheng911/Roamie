import { resolveServerEnv } from "@/lib/load-env.server";

const UNSPLASH_SEARCH = "https://api.unsplash.com/search/photos";
const STYLE_SUFFIX = "soft pastel cinematic travel lifestyle aesthetic";

export type UnsplashPhotoHit = {
  imageUrl: string;
  query: string;
  unsplashPhotoId: string | null;
  photographerName: string | null;
  photographerUrl: string | null;
};

export function requireUnsplashAccessKey(): string {
  const resolved =
    resolveServerEnv("UNSPLASH_ACCESS_KEY") ?? resolveServerEnv("VITE_UNSPLASH_ACCESS_KEY");
  const key = resolved?.value?.trim();
  if (!key) {
    throw new Error(
      "UNSPLASH_ACCESS_KEY 尚未設定。請在 .env 加入 UNSPLASH_ACCESS_KEY 後執行 npm run sync:env",
    );
  }
  return key;
}

type UnsplashApiResult = {
  id?: string;
  urls?: { regular?: string; small?: string };
  user?: { name?: string; links?: { html?: string } };
};

/** 單一 query 搜尋 Unsplash（server-only） */
export async function searchUnsplashPhoto(query: string): Promise<UnsplashPhotoHit | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const clientId = requireUnsplashAccessKey();
  const fullQuery = `${trimmed} ${STYLE_SUFFIX}`.trim();
  const params = new URLSearchParams({
    query: fullQuery,
    per_page: "8",
    orientation: "landscape",
    content_filter: "high",
  });

  const res = await fetch(`${UNSPLASH_SEARCH}?${params}`, {
    headers: { Authorization: `Client-ID ${clientId}` },
  });
  if (!res.ok) {
    console.warn("[unsplash] search failed", res.status, trimmed);
    return null;
  }

  const data = (await res.json()) as { results?: UnsplashApiResult[] };
  const hit = data.results?.find((r) => r.urls?.regular || r.urls?.small);
  const imageUrl = hit?.urls?.regular ?? hit?.urls?.small;
  if (!imageUrl) return null;

  return {
    imageUrl,
    query: trimmed,
    unsplashPhotoId: hit?.id ?? null,
    photographerName: hit?.user?.name ?? null,
    photographerUrl: hit?.user?.links?.html ?? null,
  };
}

/** 依序嘗試多個 query */
export async function searchUnsplashWithQueries(
  queries: string[],
): Promise<UnsplashPhotoHit | null> {
  for (const q of queries) {
    const hit = await searchUnsplashPhoto(q);
    if (hit) return hit;
  }
  return null;
}
