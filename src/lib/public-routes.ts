function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/**
 * Public pages that must stay reachable without onboarding/auth redirects.
 * Keep this list explicit to avoid weakening protected app routes.
 */
export function isPublicOnboardingBypassPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === "/support" || path === "/privacy" || path === "/login/legal";
}
