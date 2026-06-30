const failedImageUrls = new Set<string>();

function failureKey(url: string): string {
  return url.trim().split("?")[0]?.toLowerCase() ?? url.trim().toLowerCase();
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
