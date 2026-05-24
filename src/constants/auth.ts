/**
 * Sign in with Apple requires Apple Developer Program enrollment,
 * Services ID, and Supabase Apple provider configuration.
 * Enable via VITE_APPLE_SIGN_IN_ENABLED=true once ready.
 */
export const APPLE_SIGN_IN_ENABLED =
  import.meta.env.VITE_APPLE_SIGN_IN_ENABLED === "true";

export type OAuthProvider = "google" | "apple";

export function isOAuthProviderEnabled(provider: OAuthProvider): boolean {
  if (provider === "apple") return APPLE_SIGN_IN_ENABLED;
  return true;
}
