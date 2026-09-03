/** 首頁 tab 是否為目前可見 route（非 keep-alive hidden） */
let homeRouteVisible = false;
const listeners = new Set<() => void>();

export function setHomeRouteVisible(visible: boolean): void {
  if (homeRouteVisible === visible) return;
  homeRouteVisible = visible;
  for (const listener of listeners) listener();
}

export function isHomeRouteVisible(): boolean {
  return homeRouteVisible;
}

export function subscribeHomeRouteVisible(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
