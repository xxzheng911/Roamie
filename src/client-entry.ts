/**
 * Capacitor / TanStack Start 實際 client bundle 第一個模組（由 router.tsx import）。
 * 若 Xcode 看不到此 log，代表實機未載入最新 build（需 npm run build && cap sync）。
 */
import { Capacitor } from "@capacitor/core";

console.log("[REAL_ENTRY] src/client-entry.ts loaded");
console.log("[REAL_ENTRY] platform=", Capacitor.getPlatform?.() ?? "unknown");
