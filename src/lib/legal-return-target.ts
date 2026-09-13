const LEGAL_RETURN_TARGET_ALLOWLIST = new Set(["/support", "/login"]);

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

/**
 * Resolve legal-page back target from query param.
 * Only explicit internal paths are allowed to prevent open redirects.
 */
export function resolveLegalReturnTarget(from: unknown): "/support" | "/login" {
  if (typeof from !== "string") return "/login";
  const normalized = normalizePath(from.trim());
  if (!normalized.startsWith("/")) return "/login";
  if (normalized.startsWith("//")) return "/login";
  return LEGAL_RETURN_TARGET_ALLOWLIST.has(normalized)
    ? (normalized as "/support" | "/login")
    : "/login";
}
