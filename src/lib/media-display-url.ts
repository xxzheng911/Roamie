/** 顯示用 cache-bust（DB / Storage 仍存穩定 URL；僅在上傳後帶 revision 時附加） */
export function withCacheBust(url: string | null | undefined, revision?: number): string | null {
  if (!url) return null;
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (revision == null || revision === 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${revision}`;
}

export function stripMediaUrlQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

export function isSameMediaUrl(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return stripMediaUrlQuery(a) === stripMediaUrlQuery(b);
}
