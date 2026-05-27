import { supabase } from "@/lib/supabase";
import { requireAuthenticatedUser } from "@/lib/auth-session";
import {
  logAvatarPublicUrlCreated,
  logAvatarUploadFailed,
  logAvatarUploadStarted,
  logAvatarUploadSuccess,
  logProfileAvatarUpdateFailed,
  logProfileAvatarUpdateStarted,
  logProfileAvatarUpdateSuccess,
} from "@/lib/avatar-upload-log";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { cropImageToCover, cropImageToSquare } from "@/lib/image-crop";

export type ProfileMediaKind = "avatar" | "cover";

const BUCKET = "profile-media";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function normalizeAvatarBlob(blob: Blob): Blob {
  if (blob.size === 0) {
    throw new Error("裁切後的圖片為空，請重新選擇");
  }
  if (blob.size > MAX_AVATAR_BYTES) {
    throw new Error("圖片過大，請縮小後再試（上限 2MB）");
  }
  if (blob.type === "image/jpeg" || blob.type === "image/png") {
    return blob;
  }
  return new Blob([blob], { type: "image/jpeg" });
}

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
  const body = kind === "avatar" ? normalizeAvatarBlob(blob) : blob;

  logAvatarUploadStarted({ userId, kind, path, bytes: body.size, contentType: body.type });

  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });
  if (error) {
    logAvatarUploadFailed({ path, message: error.message, statusCode: (error as { statusCode?: string }).statusCode });
    throw new Error(`上傳失敗：${error.message}`);
  }

  logAvatarUploadSuccess({ path, bytes: body.size });

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  if (kind === "avatar") {
    logAvatarPublicUrlCreated(url);
  }
  return url;
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

  logProfileAvatarUpdateStarted(id);
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: url })
    .eq("id", id);
  if (error) {
    logProfileAvatarUpdateFailed({ userId: id, message: error.message });
    throw new Error(`更新個人資料失敗：${error.message}`);
  }

  logProfileAvatarUpdateSuccess(id);
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

