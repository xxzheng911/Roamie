/** 啟動畫面（#roamie-boot-splash）與首屏就緒判斷 — 避免雙 Loading */

export function hasExternalBootSplash(): boolean {
  if (typeof document === "undefined") return false;
  return document.getElementById("roamie-boot-splash") != null;
}

export function dismissExternalBootSplash(): void {
  if (typeof document === "undefined") return;
  document.getElementById("roamie-boot-splash")?.remove();
  document.getElementById("roamie-static-boot")?.remove();
}

/** 真實 App UI（不含 boot splash / loading overlay） */
export function rootHasRealAppContent(): boolean {
  const root = document.getElementById("root");
  if (!root || root.childElementCount === 0) return false;

  const splashOnly =
    root.querySelector(".roamie-splash") != null &&
    root.querySelector("main,nav,[role=main]") == null;
  if (splashOnly) return false;

  return (
    root.querySelector("main,nav,[role=main],button,a[href],input,form") != null
  );
}

/**
 * 等首屏真實 UI 出現後移除 HTML boot splash。
 * 僅在 OnboardingGate / 登入頁等明確時機呼叫。
 */
export function dismissBootSplashWhenAppReady(): void {
  if (typeof document === "undefined") return;
  if (!hasExternalBootSplash()) return;

  const attempt = () => {
    if (rootHasRealAppContent()) {
      dismissExternalBootSplash();
      return true;
    }
    return false;
  };

  if (attempt()) return;

  let tries = 0;
  const maxTries = 120;
  const timer = window.setInterval(() => {
    tries += 1;
    if (attempt() || tries >= maxTries) {
      window.clearInterval(timer);
      if (tries >= maxTries) dismissExternalBootSplash();
    }
  }, 50);
}
