const ADMIN_RETURN_TARGET_KEY = "roamie:admin:return-to";
const ADMIN_ROOT_PATH = "/admin";

function normalizePathname(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] ?? pathname;
  return withoutQuery.replace(/\/+$/, "") || "/";
}

export function isAdminRoute(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === ADMIN_ROOT_PATH || path.startsWith(`${ADMIN_ROOT_PATH}/`);
}

export function hasPendingAdminReturn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(ADMIN_RETURN_TARGET_KEY) === ADMIN_ROOT_PATH;
  } catch {
    return false;
  }
}

export function stashAdminReturn(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ADMIN_RETURN_TARGET_KEY, ADMIN_ROOT_PATH);
  } catch {
    // A blocked sessionStorage must not break the existing login flow.
  }
}

export function consumeAdminReturn(): "/admin" | null {
  if (!hasPendingAdminReturn()) return null;
  try {
    window.sessionStorage.removeItem(ADMIN_RETURN_TARGET_KEY);
  } catch {
    // The target remains constrained to /admin even when cleanup is blocked.
  }
  return ADMIN_ROOT_PATH;
}

export function isAdminAuthBoundaryRoute(
  pathname: string,
  pendingAdminReturn = hasPendingAdminReturn(),
): boolean {
  const path = normalizePathname(pathname);
  if (isAdminRoute(path)) return true;
  if (!pendingAdminReturn) return false;
  return path === "/login" || path.startsWith("/login/") || path === "/auth/callback";
}
