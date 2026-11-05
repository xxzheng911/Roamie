const failedImageUrls = new Set<string>();

/**
 * /api/place-photo 的身分在 query（photo＋w）；去 query 會讓所有 proxy 照片共用同一 key。
 * 以 photo name＋寬度為 key，signature／expires 變動不影響同一張圖，不同照片互不污染。
 */
function placePhotoProxyFailureKey(url: string): string | null {
  if (!url.includes("/api/place-photo")) return null;
  try {
    const parsed = new URL(url, "https://roamie.invalid");
    if (!parsed.pathname.endsWith("/api/place-photo")) return null;
    const photo = parsed.searchParams.get("photo")?.trim();
    if (!photo) return url.toLowerCase();
    const width = parsed.searchParams.get("w")?.trim() ?? "";
    return `place-photo-proxy:${photo}@${width}`;
  } catch {
    return url.toLowerCase();
  }
}

function failureKey(url: string): string {
  const trimmed = url.trim();
  const proxyKey = placePhotoProxyFailureKey(trimmed);
  if (proxyKey) return proxyKey;
  return trimmed.split("?")[0]?.toLowerCase() ?? trimmed.toLowerCase();
}

export function markImageLoadFailed(url: string | null | undefined): void {
  if (!url?.trim()) return;
  const trimmed = url.trim();
  failedImageUrls.add(trimmed);
  failedImageUrls.add(failureKey(trimmed));
}

export function markPlacePhotoNameFailed(photoName: string | null | undefined): void {
  const name = photoName?.trim();
  if (!name) return;
  failedImageUrls.add(`photo:${name}`);
}

export function isPlacePhotoNameFailed(photoName: string | null | undefined): boolean {
  const name = photoName?.trim();
  if (!name) return false;
  return failedImageUrls.has(`photo:${name}`);
}

export function isImageLoadFailed(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  const trimmed = url.trim();
  return failedImageUrls.has(trimmed) || failedImageUrls.has(failureKey(trimmed));
}

export function clearImageLoadFailure(url: string | null | undefined): void {
  if (!url?.trim()) return;
  const trimmed = url.trim();
  failedImageUrls.delete(trimmed);
  failedImageUrls.delete(failureKey(trimmed));
}
