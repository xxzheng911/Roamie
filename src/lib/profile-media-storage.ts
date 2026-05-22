import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { cropImageToCover, cropImageToSquare } from "@/lib/image-crop";

export type ProfileMediaKind = "avatar" | "cover";

const BUCKET = "profile-media";

function mediaPath(userId: string, kind: ProfileMediaKind): string {
  return `${userId}/${kind}.jpg`;
}

export { getAuthenticatedUserId as getAuthUserId } from "@/lib/auth-session";

export async function uploadProfileMedia(
  userId: string,
  kind: ProfileMediaKind,
  blob: Blob,
): Promise<string> {
  const path = mediaPath(userId, kind);
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function deleteProfileMedia(
  userId: string,
  kind: ProfileMediaKind,
): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([mediaPath(userId, kind)]);
  if (error) throw new Error(error.message);
}

export async function processAndUploadProfileImage(
  file: File,
  kind: ProfileMediaKind,
): Promise<string> {
  const userId = await getAuthenticatedUserId();
  if (!userId) throw new Error("請先登入後再上傳圖片");

  const blob =
    kind === "cover" ? await cropImageToCover(file) : await cropImageToSquare(file);
  return uploadProfileMedia(userId, kind, blob);
}
