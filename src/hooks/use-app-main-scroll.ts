import { useLayoutEffect } from "react";

/** 可捲動 App 子頁：還原 main 滾動並清除聊聊/地圖留下的 inline overflow */
export function useAppMainScroll(): void {
  useLayoutEffect(() => {
    document.documentElement.classList.remove("map-route-active");

    const main = document.querySelector("main.app-scroll");
    if (!(main instanceof HTMLElement)) return;

    main.style.removeProperty("overflow");
    main.style.removeProperty("overflow-y");
    main.style.removeProperty("overflow-x");
  }, []);
}
