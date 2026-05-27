import { readGoogleMapsKeyFromClientEnv } from "@/lib/google-maps-key-resolve";

/** 單行輸出，方便 Xcode 搜尋 `[GOOGLE_KEY]` */
export function logGoogleKeyStatus(tag = "boot"): void {
  const key = readGoogleMapsKeyFromClientEnv();
  if (key) {
    console.info(
      `[GOOGLE_KEY] loaded=true prefix=${key.slice(0, 8)} length=${key.length} tag=${tag}`,
    );
  } else {
    console.warn(`[GOOGLE_KEY] loaded=false tag=${tag}`);
  }
}

/** 探索地圖啟動診斷（不印完整 key） */
export function logMapComponentKeyDiagnostics(tag = "MAP_COMPONENT"): void {
  const key = readGoogleMapsKeyFromClientEnv();
  const exists = Boolean(key);
  console.info(`[${tag}] apiKey exists=${exists}`);
  if (key) {
    console.info(`[${tag}] apiKey prefix=${key.slice(0, 8)} length=${key.length}`);
  }
  logGoogleKeyStatus(tag);
}

/** 單行輸出，方便 Xcode 搜尋 `[MAP_FALLBACK]` */
export function logMapFallback(reason: string): void {
  console.info(`[MAP_FALLBACK] reason=${reason}`);
}

/** 進入探索頁時固定打一組 boot log（不依地圖是否掛載） */
export function logExploreMapBoot(): void {
  console.info("[EXPLORE_SCREEN] boot");
  logGoogleKeyStatus("explore");
  logMapFallback("boot");
}
