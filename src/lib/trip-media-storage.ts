import { supabase } from "@/lib/supabase";
import { requireAuthenticatedUser } from "@/lib/auth-session";

const BUCKET = "profile-media";
const MAX_BYTES = 6 * 1024 * 1024;

export type TripCoverUploadResult =
  | { ok: true; url: string; path: string }
  | { ok: false; error: string };

function tripCoverPath(userId: string, tripId: string, timestamp: number): string {
  return `${userId}/trips/${tripId}/cover_${timestamp}.jpg`;
}

function normalizeUploadBody(blob: Blob): Blob | null {
  if (blob.size === 0) return null;
  if (blob.size > MAX_BYTES) return null;
  if (blob.type === "image/jpeg" || blob.type === "image/png") return blob;
  return new Blob([blob], { type: "image/jpeg" });
}

function storagePathFromPublicUrl(url: string): string | null {
  try {
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    const raw = url.slice(idx + marker.length).split("?")[0]?.trim();
    return raw ? decodeURIComponent(raw) : null;
  } catch {
    return null;
  }
}

/** 上傳行程自訂封面至 Supabase Storage（安全版，不 throw） */
export async function uploadTripCoverSafe(tripId: string, blob: Blob): Promise<TripCoverUploadResult> {
  try {
    const body = normalizeUploadBody(blob);
    if (!body) {
      return { ok: false, error: blob.size > MAX_BYTES ? "圖片過大，請縮小後再試（上限 6MB）" : "圖片為空，請重新選擇" };
    }

    const user = await requireAuthenticatedUser();
    const timestamp = Date.now();
    const path = tripCoverPath(user.id, tripId, timestamp);

    const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
      upsert: false,
      contentType: "image/jpeg",
      cacheControl: "3600",
    });
    if (error) {
      return { ok: false, error: `上傳失敗：${error.message}` };
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (!data.publicUrl?.trim()) {
      return { ok: false, error: "上傳失敗：無法取得圖片網址" };
    }

    return { ok: true, url: data.publicUrl, path };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "上傳失敗";
    return { ok: false, error: msg };
  }
}

/** @deprecated 請改用 uploadTripCoverSafe */
export async function uploadTripCover(tripId: string, blob: Blob): Promise<string> {
  const result = await uploadTripCoverSafe(tripId, blob);
  if (!result.ok) throw new Error(result.error);
  return result.url;
}

/** 刪除舊封面（失敗不 throw） */
export async function removeTripCoverByUrl(url: string | null | undefined): Promise<void> {
  const path = url?.trim() ? storagePathFromPublicUrl(url.trim()) : null;
  if (!path) return;
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) {
      console.info("[COVER_UPLOAD_ERROR]", `remove failed path=${path}`, error.message);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.info("[COVER_UPLOAD_ERROR]", `remove exception path=${path}`, msg);
  }
}
