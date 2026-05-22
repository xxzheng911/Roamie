import type { User } from "@supabase/supabase-js";

export type AuthProviderKind = "google" | "apple" | "email";

export function resolveAuthProvider(user: User): AuthProviderKind {
  const fromMeta = user.app_metadata?.provider as string | undefined;
  if (fromMeta === "google") return "google";
  if (fromMeta === "apple") return "apple";

  const identity = user.identities?.find((i) => i.provider === "google" || i.provider === "apple");
  if (identity?.provider === "google") return "google";
  if (identity?.provider === "apple") return "apple";

  return "email";
}
