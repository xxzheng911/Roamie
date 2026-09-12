import type { User } from "@supabase/supabase-js";

export type AuthProviderKind = "google" | "apple" | "email";

function asKnownProvider(value: unknown): AuthProviderKind | null {
  return value === "google" || value === "apple" || value === "email" ? value : null;
}

/**
 * Display-only provider authority. Prefer Supabase's primary provider for the
 * current session. If it is absent, only use a fallback when all available
 * identity metadata resolves unambiguously to one provider.
 */
export function resolveAuthProviderForDisplay(user: User): AuthProviderKind | null {
  const primary = asKnownProvider(user.app_metadata?.provider);
  if (primary) return primary;

  const candidates = new Set<AuthProviderKind>();
  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers)) {
    for (const provider of providers) {
      const known = asKnownProvider(provider);
      if (known) candidates.add(known);
    }
  }
  for (const identity of user.identities ?? []) {
    const known = asKnownProvider(identity.provider);
    if (known) candidates.add(known);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function resolveAuthProvider(user: User): AuthProviderKind {
  const fromMeta = user.app_metadata?.provider as string | undefined;
  if (fromMeta === "google") return "google";
  if (fromMeta === "apple") return "apple";

  const identity = user.identities?.find((i) => i.provider === "google" || i.provider === "apple");
  if (identity?.provider === "google") return "google";
  if (identity?.provider === "apple") return "apple";

  return "email";
}
