import { canUseNativeAppleSignIn } from "@/lib/auth-apple-native";

/**
 * Sign in with Apple — Supabase Apple provider + iOS 原生登入。
 * 建置前請在 .env 設定 VITE_APPLE_SIGN_IN_ENABLED=true
 */
export const APPLE_SIGN_IN_ENABLED =
  import.meta.env.VITE_APPLE_SIGN_IN_ENABLED === "true";

export type OAuthProvider = "google" | "apple";

export function isOAuthProviderEnabled(provider: OAuthProvider): boolean {
  if (provider === "apple") {
    return APPLE_SIGN_IN_ENABLED || canUseNativeAppleSignIn();
  }
  return true;
}
