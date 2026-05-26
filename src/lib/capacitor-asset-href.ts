/** Capacitor bundled index 含 `<base href="/" />` 時，保留 `/assets/*` 根路徑即可 */
export function toCapacitorBundledAssetHref(href: string): string {
  if (typeof window === "undefined") return href;
  if (href.startsWith("assets/")) return `/${href}`;
  return href;
}
