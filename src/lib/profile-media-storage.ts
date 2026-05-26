import { supabase } from "@/lib/supabase";
import { requireAuthenticatedUser } from "@/lib/auth-session";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { cropImageToCover, cropImageToSquare } from "@/lib/image-crop";

export type ProfileMediaKind = "avatar" | "cover";

const BUCKET = "profile-media";

/** profile-media/{userId}/avatar.jpg | cover.jpg */
export function profileMediaPath(userId: string, kind: ProfileMediaKind): string {
  return `${userId}/${kind}.jpg`;
}

export { getAuthenticatedUserId as getAuthUserId, requireAuthenticatedUser } from "@/lib/auth-session";

export async function uploadProfileMedia(
  userId: string,
  kind: ProfileMediaKind,
  blob: Blob,
): Promise<string> {
  const authed = await requireAuthenticatedUser();
  if (authed.id !== userId) {
    throw new Error("只能上傳到自己的個人資料");
  }

  await ensureUserProfile(userId);

  const path = profileMediaPath(userId, kind);
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });
  if (error) {
    console.error("[profile-media] upload failed", { path, message: error.message });
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function deleteProfileMedia(
  userId: string,
  kind: ProfileMediaKind,
): Promise<void> {
  const authed = await requireAuthenticatedUser();
  if (authed.id !== userId) {
    throw new Error("只能刪除自己的個人資料");
  }

  const path = profileMediaPath(userId, kind);
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

/** 上傳並寫入 profiles.avatar_url */
export async function applyProfileAvatar(blob: Blob): Promise<string> {
  const { id } = await requireAuthenticatedUser();
  await ensureUserProfile(id);
  const url = await uploadProfileMedia(id, "avatar", blob);

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: url })
    .eq("id", id);
  if (error) throw new Error(error.message);

  return url;
}

/** 上傳並寫入 profiles.cover_image_url */
export async function applyProfileCover(blob: Blob): Promise<string> {
  const { id } = await requireAuthenticatedUser();
  await ensureUserProfile(id);
  const url = await uploadProfileMedia(id, "cover", blob);

  const { error } = await supabase
    .from("profiles")
    .update({ cover_image_url: url })
    .eq("id", id);
  if (error) throw new Error(error.message);

  return url;
}

/** 移除封面（storage + profiles） */
export async function removeProfileCover(): Promise<void> {
  const { id } = await requireAuthenticatedUser();
  await ensureUserProfile(id);
  try {
    await deleteProfileMedia(id, "cover");
  } catch {
    /* file may not exist */
  }
  const { error } = await supabase
    .from("profiles")
    .update({ cover_image_url: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function processAndUploadProfileImage(
  file: File,
  kind: ProfileMediaKind,
): Promise<string> {
  const blob =
    kind === "cover" ? await cropImageToCover(file) : await cropImageToSquare(file);
  return kind === "cover" ? applyProfileCover(blob) : applyProfileAvatar(blob);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("無法讀取圖片"));
    reader.readAsDataURL(blob);
  });
}

/** 訪客模式：大頭貼存本機（data URL），並同步首頁頭像 */
export async function applyGuestProfileAvatar(blob: Blob): Promise<string> {
  const { saveUserProfile } = await import("@/lib/profile-storage");
  const url = await blobToDataUrl(blob);
  await saveUserProfile({ avatarUrl: url });
  return url;
}

/** 訪客模式：封面存本機 */
export async function applyGuestProfileCover(blob: Blob): Promise<string> {
  const { saveUserProfile } = await import("@/lib/profile-storage");
  const url = await blobToDataUrl(blob);
  await saveUserProfile({ coverImageUrl: url });
  return url;
}

export async function removeGuestProfileCover(): Promise<void> {
  const { saveUserProfile } = await import("@/lib/profile-storage");
  await saveUserProfile({ coverImageUrl: null });
}
