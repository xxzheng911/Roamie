/** 登入頁冷啟動（可略過重型 provider / 背景 auth） */
export function isLoginColdStartPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/login" || path.startsWith("/login/");
}

export function isAuthCallbackPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path.startsWith("/auth/");
}

/** 僅登入頁且尚未確認 session 時使用輕量殼層 */
export function shouldUseLightStartupShell(pathname: string, hasUser: boolean, loading: boolean): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (isAuthCallbackPath(path)) return false;
  if (isLoginColdStartPath(path)) return loading || !hasUser;
  return false;
}

export function readBrowserPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname.replace(/\/+$/, "") || "/";
}
