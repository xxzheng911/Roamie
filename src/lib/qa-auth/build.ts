/**
 * QA 測試登入僅在開發或明確標記的 TestFlight debug build 啟用。
 * 正式 App Store production 建置不應設定 VITE_ROAMIE_QA=1。
 */
export function isQaBuildEnabled(): boolean {
  if (import.meta.env.VITE_ROAMIE_QA === "0") return false;
  return import.meta.env.DEV || import.meta.env.VITE_ROAMIE_QA === "1";
}

/** 供 API 請求標記 QA build（與 server ROAMIE_QA_AUTH_ENABLED 搭配） */
export function qaClientBuildHeaderValue(): string | undefined {
  return isQaBuildEnabled() ? "1" : undefined;
}
