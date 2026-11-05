import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { writePlaceRuntimeCache } from "@/lib/place-runtime-cache";
import { patchSavedPlaceImage, type SavedPlace } from "@/lib/places-storage";
import { extractGooglePlacePhotoName, preferJpegPngImageUrl } from "@/lib/safe-image-url";
import {
  isRoamieDefaultImageUrl,
  resolveSavedPlaceGooglePlaceId,
  resolveSavedPlacePhotoResource,
} from "@/lib/saved-place-utils";

/**
 * 收藏地點的舊 photo name 被 Google 拒絕（過期），或收藏時只存了 Roamie 預設圖時，
 * 以 placeId 重抓一次 Details 取新 photo name。
 * 每個 placeId 在 App 執行期間最多呼叫一次 Details（in-flight 去重＋已嘗試記錄），失敗不重試。
 */
const attempted = new Set<string>();
const inflight = new Map<string, Promise<string | null>>();
const refreshed = new Map<string, string>();
/** 本次執行期間已送出寫回的 saved_places row id（同 placeId 的多筆收藏各寫回一次）。 */
const persistedRows = new Set<string>();

function normalizePlaceId(placeId: string): string {
  return placeId.trim().replace(/^places\//, "");
}

/** 本次執行期間已成功換新的 photo name（無則 null）。 */
export function readRefreshedSavedPlacePhotoName(
  placeId: string | null | undefined,
): string | null {
  if (!placeId) return null;
  return refreshed.get(normalizePlaceId(placeId)) ?? null;
}

function buildPersistPatch(place: SavedPlace, photoName: string) {
  const unsigned = preferJpegPngImageUrl(buildPlacePhotoUrl(photoName, 600));
  // 只替換原本就是 Google 照片 URL 或 Roamie 預設圖的欄位；使用者上傳或其他來源維持不動。
  const replaceIfReplaceable = (value: string | null) =>
    value && (extractGooglePlacePhotoName(value) || isRoamieDefaultImageUrl(value))
      ? unsigned
      : value;
  return {
    metadata: { ...(place.metadata ?? {}), photoName },
    cover_image: replaceIfReplaceable(place.cover_image),
    image_url: replaceIfReplaceable(place.image_url),
  };
}

/** 對這筆 row 寫回新 photo name（每個 row 每次執行最多一次；已是同名則略過）。 */
function persistRefreshedPhotoName(place: SavedPlace, photoName: string): void {
  if (persistedRows.has(place.id)) return;
  persistedRows.add(place.id);
  if (resolveSavedPlacePhotoResource(place) === photoName) return;
  void patchSavedPlaceImage(place.id, buildPersistPatch(place, photoName)).catch((error) => {
    console.warn("[SAVED_PLACE_PHOTO_REFRESH] persist failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  });
}

/**
 * 照片確實載入失敗（傳入失敗的 photo name），或收藏只有 Roamie 預設圖／無封面（不傳）時呼叫。
 * 回傳新 photo name；沒有 placeId、Details 失敗、無照片、或新名稱與失敗的相同 → 回 null
 * （維持預設圖，不重試）。
 */
export function refreshSavedPlacePhotoName(
  place: SavedPlace,
  failedPhotoName?: string | null,
): Promise<string | null> {
  const rawPlaceId = resolveSavedPlaceGooglePlaceId(place);
  if (!rawPlaceId) return Promise.resolve(null);
  const key = normalizePlaceId(rawPlaceId);
  const failed = failedPhotoName?.trim() || null;

  const done = refreshed.get(key);
  if (done) {
    if (done === failed) return Promise.resolve(null);
    // 同 placeId 的另一筆收藏：沿用已換新的名稱，並對自己這筆 row 寫回。
    persistRefreshedPhotoName(place, done);
    return Promise.resolve(done);
  }
  const pending = inflight.get(key);
  if (pending) {
    return pending.then((next) => {
      if (next) persistRefreshedPhotoName(place, next);
      return next;
    });
  }
  if (attempted.has(key)) return Promise.resolve(null);
  attempted.add(key);

  const task = (async (): Promise<string | null> => {
    let next: string | null = null;
    try {
      const { getPlaceDetailsServerFnViaGateway } = await import("@/lib/pie/places-gateway");
      const detail = await getPlaceDetailsServerFnViaGateway({ data: { placeId: rawPlaceId } });
      next = detail.place?.photoName?.trim() || null;
    } catch (error) {
      console.warn("[SAVED_PLACE_PHOTO_REFRESH] details failed", {
        reason: error instanceof Error ? error.name : "unknown",
      });
      return null;
    }
    if (!next || next === failed) return null;

    refreshed.set(key, next);
    writePlaceRuntimeCache(rawPlaceId, {
      photoName: next,
      coverImageUrl: preferJpegPngImageUrl(buildPlacePhotoUrl(next, 600)),
    });
    persistRefreshedPhotoName(place, next);
    return next;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
}
