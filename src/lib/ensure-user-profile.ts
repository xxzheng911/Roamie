import type { User } from "@supabase/supabase-js";
import { resolveAuthProvider } from "@/lib/auth-provider";
import { detectDeviceLocale } from "@/lib/i18n/detect-locale";
import { getDefaultBio, getDefaultDisplayName } from "@/lib/i18n/default-profile";
import type { Locale } from "@/lib/i18n/types";
import { supabase } from "@/lib/supabase";

export function roamieProfileDefaults(user: User, locale: Locale = detectDeviceLocale()) {
  return {
    id: user.id,
    display_name: getDefaultDisplayName(locale),
    avatar_url: null as string | null,
    cover_image_url: null as string | null,
    bio: getDefaultBio(locale),
    language: locale,
    notifications_enabled: false,
    auth_provider: resolveAuthProvider(user),
  };
}

/**
 * 若 public.profiles 尚無此使用者，建立 Roamie 預設資料（不使用 OAuth 顯示名／頭像）。
 */
export async function ensureUserProfile(explicitUserId?: string): Promise<boolean> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) return false;

  const userId = explicitUserId ?? user.id;
  if (userId !== user.id) {
    throw new Error("無法為其他使用者建立個人資料");
  }

  const { data: existing, error: selectError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  if (existing?.id) return false;

  const defaults = roamieProfileDefaults(user);
  const { error: insertError } = await supabase.from("profiles").insert(defaults);

  if (insertError) {
    if (insertError.code === "23505") return false;
    throw new Error(insertError.message);
  }

  return true;
}

/** 補齊 language / auth_provider（舊資料或 DB trigger 先建立時） */
export async function syncProfileAppFields(userId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== userId) return;

  const { data: row } = await supabase
    .from("profiles")
    .select("language, auth_provider, bio, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (!row) return;

  const locale = detectDeviceLocale();
  const patch: Record<string, unknown> = {};

  if (!row.language) patch.language = locale;
  if (!row.auth_provider) patch.auth_provider = resolveAuthProvider(user);
  if (!row.bio?.trim()) patch.bio = getDefaultBio((row.language as Locale) || locale);
  if (!row.display_name?.trim()) patch.display_name = getDefaultDisplayName((row.language as Locale) || locale);

  if (Object.keys(patch).length === 0) return;

  await supabase.from("profiles").update(patch).eq("id", userId);
}
