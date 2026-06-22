/** iOS WKWebView often fails on WebP; prefer JPEG/PNG at load time. */
export function isWebpImageUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  return /\.webp(\?|$|#)/i.test(url) || /[?&]fm=webp/i.test(url);
}

/** Return a WKWebView-safe image URL, or null when only WebP is available. */
export function preferJpegPngImageUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (isWebpImageUrl(trimmed)) return null;

  try {
    if (trimmed.includes("images.unsplash.com") || trimmed.includes("source.unsplash.com")) {
      const parsed = new URL(trimmed);
      parsed.searchParams.set("fm", "jpg");
      parsed.searchParams.delete("auto");
      return parsed.toString();
    }
  } catch {
    /* ignore malformed URLs */
  }

  return trimmed;
}
