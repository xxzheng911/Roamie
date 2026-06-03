/** 規劃頁：手動建立行程 — 寫入 Supabase 上限 */
export const MANUAL_TRIP_SAVE_TIMEOUT_MS = 25_000;

/** 規劃頁：讀取偏好（不可無限等待） */
export const PLAN_PREFS_TIMEOUT_MS = 5_000;

/** 規劃頁 AI：天氣 optional 上限 */
export const PLAN_WEATHER_TIMEOUT_MS = 4_000;

/** 規劃頁 AI：OpenAI 請求前總防呆 */
export const PLAN_PRE_OPENAI_TIMEOUT_MS = 20_000;

/** 規劃頁 AI：完整 pipeline（含 save） */
export const PLAN_AI_FULL_PIPELINE_TIMEOUT_MS = 180_000;

/** 分階段寫入：單一步驟上限 */
export const TRIP_STAGED_STEP_TIMEOUT_MS = 12_000;

/** AI 行程：save 上限 */
export const PLAN_AI_SAVE_TIMEOUT_MS = 60_000;
