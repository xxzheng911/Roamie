/** 首頁 tab 是否為目前可見 route（非 keep-alive hidden） */
let homeRouteVisible = false;

export function setHomeRouteVisible(visible: boolean): void {
  homeRouteVisible = visible;
}

export function isHomeRouteVisible(): boolean {
  return homeRouteVisible;
}
