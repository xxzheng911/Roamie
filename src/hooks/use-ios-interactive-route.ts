import { useLayoutEffect } from "react";
import { bindIosInteractiveRoute } from "@/lib/ios-snapshot-bridge";

/** Capacitor iOS 26：路由頁需直接觸控 WebView（mirror 滯後時會點不到按鈕） */
export function useIosInteractiveRoute(reason: string): void {
  useLayoutEffect(() => {
    if (!reason || reason.startsWith("__skip__")) return undefined;
    return bindIosInteractiveRoute(reason);
  }, [reason]);
}
