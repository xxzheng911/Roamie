/** Resolve against the API endpoint, never an opaque WebView location.origin. */
export function resolveSignedPhotoResponse(
  body: unknown,
  endpoint: string,
  pageHref: string,
): string | null {
  if (!body || typeof body !== "object" || !("url" in body) || typeof body.url !== "string") return null;
  try {
    const api = new URL(endpoint, pageHref);
    const url = new URL(body.url, api);
    if (url.origin !== api.origin || url.pathname !== "/api/place-photo" || url.username || url.password || url.hash) return null;
    if (!["https:", "http:"].includes(url.protocol)) return null;
    const expires = Number(url.searchParams.get("expires"));
    if (!url.searchParams.get("photo") || !url.searchParams.get("signature") || !Number.isFinite(expires) || expires <= 0) return null;
    return url.href;
  } catch { return null; }
}
