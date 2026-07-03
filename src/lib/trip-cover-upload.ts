import type { StoredItinerary } from "@/lib/itinerary-storage";
import { buildCustomCoverPatch } from "@/lib/saved-trip/display";
import { patchSavedTripInSnapshot } from "@/lib/saved-list-snapshot";
import { invalidateLoadedImageCache } from "@/components/media/FadeInImage";
import { clearImageLoadFailure } from "@/lib/image-url-failure-cache";
import { withCacheBust } from "@/lib/media-display-url";
import { uploadTripCoverSafe, removeTripCoverByUrl } from "@/lib/trip-media-storage";

const MAX_COVER_BYTES = 6 * 1024 * 1024;

export type CoverUploadApplyInput = {
  tripId: string;
  blob: Blob;
  stored: StoredItinerary;
};

export type CoverUploadApplyResult =
  | { ok: true; url: string; displayUrl: string; revision: number; optimisticStored: StoredItinerary }
  | { ok: false; error: string };

/** 驗證裁切後的 blob 是否可上傳 */
export function validateCoverUploadBlob(blob: Blob | null | undefined): string | null {
  if (blob == null) return "圖片資料為空";
  if (!(blob instanceof Blob)) return "圖片格式無效";
  if (!Number.isFinite(blob.size) || blob.size <= 0) return "圖片為空，請重新選擇";
  if (blob.size > MAX_COVER_BYTES) return "圖片過大，請縮小後再試（上限 6MB）";
  return null;
}

/** 上傳封面至 Storage，成功後回傳帶 cache-bust 的顯示 URL */
export async function applyTripCoverUpload({
  tripId,
  blob,
  stored,
}: CoverUploadApplyInput): Promise<CoverUploadApplyResult> {
  const validationError = validateCoverUploadBlob(blob);
  if (validationError) {
    console.info("[COVER_UPLOAD_ERROR]", validationError);
    return { ok: false, error: validationError };
  }

  console.info("[COVER_UPLOAD_START]", `tripId=${tripId}`, `bytes=${blob.size}`);

  const previousUrl = stored.custom_cover_image_url?.trim() || stored.cover_image_url?.trim() || null;

  const upload = await uploadTripCoverSafe(tripId, blob);
  if (!upload.ok) {
    console.info("[COVER_UPLOAD_ERROR]", upload.error);
    return { ok: false, error: upload.error };
  }

  console.info("[COVER_UPLOAD_SUCCESS]", upload.url);

  if (previousUrl && previousUrl !== upload.url) {
    await removeTripCoverByUrl(previousUrl);
  }

  clearImageLoadFailure(upload.url);
  invalidateLoadedImageCache(upload.url);
  invalidateLoadedImageCache(previousUrl);

  const revision = Date.now();
  const optimisticUpdatedAt = new Date(revision).toISOString();
  const coverPatch = buildCustomCoverPatch(upload.url);
  const optimisticStored: StoredItinerary = {
    ...stored,
    ...coverPatch,
    cover_source: "upload",
    cover_query: null,
    updated_at: optimisticUpdatedAt,
  };

  patchSavedTripInSnapshot(tripId, {
    customCoverImageUrl: upload.url,
    coverImageUrl: upload.url,
    isCoverCustomized: true,
    updatedAt: optimisticUpdatedAt,
  });

  const displayUrl = withCacheBust(upload.url, revision) ?? upload.url;
  console.info("[COVER_STATE_UPDATED]", `tripId=${tripId}`, `revision=${revision}`);

  return {
    ok: true,
    url: upload.url,
    displayUrl,
    revision,
    optimisticStored,
  };
}
