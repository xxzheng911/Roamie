/**
 * 節慶／活動資料層（fallback 架構）
 * 目前無正式資料源 — 回傳空結果，不硬編假活動。
 * 未來可接入：國定假日 API、觀光局活動、Google Events 等。
 */

export type FestivalEvent = {
  id: string;
  title: string;
  dateRange?: string;
  kind: "holiday" | "festival" | "market" | "exhibition" | "season" | "crowd";
  summary?: string;
};

export type FestivalContext = {
  available: boolean;
  events: FestivalEvent[];
  /** 給 AI 的簡短文字；無資料時為空字串 */
  summaryForAi: string;
};

export type FestivalLookupInput = {
  lat: number;
  lng: number;
  city?: string;
  locale?: string;
  /** ISO YYYY-MM-DD */
  date?: string;
};

/** 目前 fallback：不回傳任何活動 */
export async function fetchFestivalContext(
  _input: FestivalLookupInput,
): Promise<FestivalContext> {
  return {
    available: false,
    events: [],
    summaryForAi: "",
  };
}

export function formatFestivalBlock(ctx: FestivalContext | null | undefined): string {
  if (!ctx?.available || !ctx.summaryForAi.trim()) {
    return "（當地節慶／活動資料暫不可用，請勿憑空編造節慶或市集）";
  }
  return ctx.summaryForAi;
}
