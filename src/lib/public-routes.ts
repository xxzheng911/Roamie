function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/**
 * 公開法務／支援頁：不需 Auth/AppProviders，只包 I18nProvider。
 */
export function isPublicLegalPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === "/support" || path === "/privacy" || path === "/terms" || path === "/login/legal";
}

/**
 * 行程邀請確認頁：未完成 onboarding 的訪客也要先看到預覽；
 * 但仍需完整 AppProviders（AuthProvider、AuthActionRuntime），加入時於頁面內 requireAuthForAction。
 */
export function isTripInvitePublicPath(pathname: string): boolean {
  return /^\/trip-invite\/[^/]+$/.test(normalizePath(pathname));
}

/**
 * Public pages that must stay reachable without onboarding/auth redirects.
 * Keep this list explicit to avoid weakening protected app routes.
 * （router 層 onboarding redirect 使用；= 法務頁 ∪ 行程邀請頁）
 */
export function isPublicOnboardingBypassPath(pathname: string): boolean {
  return isPublicLegalPath(pathname) || isTripInvitePublicPath(pathname);
}
