/**
 * Client bootstrap（TanStack Start 由 router.tsx import，等同 main 進入點）
 */
/** 移除 index.html 靜態占位（#root 已有內容後才移除，避免 router 初始化中空窗白屏） */
export function removeStaticBootPlaceholder(): void {
  if (typeof document === "undefined") return;
  document.getElementById("roamie-boot-splash")?.remove();
  document.getElementById("roamie-static-boot")?.remove();
}

function rootHasVisibleContent(): boolean {
  const root = document.getElementById("root");
  if (!root || root.childElementCount === 0) return false;
  return (
    root.querySelector("main,nav,[role=main],button,a[href],input,form,h1") != null
  );
}

/** 等首屏 DOM 出現再移除 boot splash（由 __root 呼叫） */
export function scheduleRemoveStaticBootPlaceholder(): void {
  if (typeof document === "undefined") return;

  const attempt = () => {
    if (rootHasVisibleContent()) {
      removeStaticBootPlaceholder();
      return true;
    }
    return false;
  };

  if (attempt()) return;

  let tries = 0;
  const maxTries = 400;
  const timer = window.setInterval(() => {
    tries += 1;
    if (attempt() || tries >= maxTries) {
      window.clearInterval(timer);
    }
  }, 50);
}
