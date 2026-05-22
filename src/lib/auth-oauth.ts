/** OAuth callback 路徑 — PKCE 僅在此頁手動 exchange */
export const AUTH_CALLBACK_PATH = "/auth/callback";

export function getAuthCallbackUrl(): string {
  if (typeof window === "undefined") return AUTH_CALLBACK_PATH;
  return `${window.location.origin}${AUTH_CALLBACK_PATH}`;
}

export function isAuthCallbackRoute(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname === AUTH_CALLBACK_PATH;
}

export function hasOAuthCallbackParams(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  const hash = window.location.hash || "";
  return (
    url.searchParams.has("code") ||
    url.searchParams.has("error") ||
    url.searchParams.has("error_description") ||
    hash.includes("access_token") ||
    hash.includes("error_description")
  );
}

export function stripOAuthParamsFromUrl(): void {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, document.title, AUTH_CALLBACK_PATH);
}
