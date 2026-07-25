export function normalizeAppPath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function isTripDetailPath(pathname: string): boolean {
  return /^\/saved\/[^/]+$/.test(normalizeAppPath(pathname));
}

/** Routes whose page component owns its vertical scrolling or fixed canvas layout. */
export function isMainScrollLockedPath(pathname: string): boolean {
  const path = normalizeAppPath(pathname);
  return (
    path === "/chat" ||
    path === "/map" ||
    path === "/plan" ||
    path === "/place" ||
    path === "/profile" ||
    path === "/travel-drafts" ||
    isTripDetailPath(path)
  );
}

export function appContentWrapperClass(mainScrollLocked: boolean): string {
  return mainScrollLocked
    ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    : "flex min-h-full min-w-0 shrink-0 flex-col";
}
