import { supabase } from "@/lib/supabase";
import { requireAuthenticatedUser } from "@/lib/auth-session";

const BUCKET = "profile-media";
const MAX_BYTES = 4 * 1024 * 1024;

/** 同一路徑 upsert 後 public URL 不變，需 bust 快取才能即時顯示新圖 */
export function cacheBustStorageUrl(publicUrl: string, version = Date.now()): string {
  try {
    const u = new URL(publicUrl);
    u.searchParams.set("v", String(version));
    return u.toString();
  } catch {
    const sep = publicUrl.includes("?") ? "&" : "?";
    return `${publicUrl}${sep}v=${version}`;
  }
}

function tripCoverPath(userId: string, tripId: string): string {
  return `${userId}/trips/${tripId}/cover.jpg`;
}

/** 上傳行程自訂封面至 Supabase Storage */
export async function uploadTripCover(tripId: string, blob: Blob): Promise<string> {
  if (blob.size === 0) throw new Error("圖片為空，請重新選擇");
  if (blob.size > MAX_BYTES) throw new Error("圖片過大，請縮小後再試（上限 4MB）");

  const user = await requireAuthenticatedUser();
  const path = tripCoverPath(user.id, tripId);

  const body =
    blob.type === "image/jpeg" || blob.type === "image/png"
      ? blob
      : new Blob([blob], { type: "image/jpeg" });

  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });
  if (error) throw new Error(`上傳失敗：${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return cacheBustStorageUrl(data.publicUrl);
}
