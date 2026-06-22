/**
 * Client bootstrap（TanStack Start 由 router.tsx import，等同 main 進入點）
 */
import {
  dismissExternalBootSplash,
  dismissBootSplashWhenAppReady,
  hasExternalBootSplash,
  rootHasRealAppContent,
} from "@/lib/boot-splash";

export {
  dismissBootSplashWhenAppReady,
  dismissExternalBootSplash,
  hasExternalBootSplash,
  rootHasRealAppContent,
};

/** @deprecated 使用 dismissExternalBootSplash */
export function removeStaticBootPlaceholder(): void {
  dismissExternalBootSplash();
}
