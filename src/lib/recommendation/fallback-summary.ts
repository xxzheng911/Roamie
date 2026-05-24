import type { RoamieRequestContext } from "@/lib/ai/context";
import type { Locale } from "@/lib/i18n/types";
import { coerceLocale } from "@/lib/i18n/resolve-locale";

const COPY: Record<Locale, { noCandidates: string; aiFailed: string }> = {
  "zh-TW": {
    noCandidates: "附近暫時找不到合適的地點，可以試試探索地圖搜尋，或稍後再問 Roamie。",
    aiFailed: "Roamie 暫時無法整理推薦，但附近還是有值得走走的地方 — 到探索頁看看？",
  },
  en: {
    noCandidates: "No good matches nearby right now. Try Explore search or ask Roamie again later.",
    aiFailed: "Roamie couldn't finish ranking — you can still browse nearby places on the map.",
  },
  ja: {
    noCandidates: "近くに候補が見つかりませんでした。探索マップを試すか、あとでもう一度どうぞ。",
    aiFailed: "おすすめの整理に失敗しました。探索マップで近くを見てみてください。",
  },
  ko: {
    noCandidates: "근처에서 적합한 장소를 찾지 못했어요. 탐색 지도를 이용해 보세요.",
    aiFailed: "추천 정리에 실패했어요. 탐색 지도에서 주변을 둘러보세요.",
  },
};

export function buildRuleBasedRecommendSummary(
  ctx: RoamieRequestContext,
  noCandidates: boolean,
): string {
  const locale = coerceLocale(ctx.locale);
  const c = COPY[locale] ?? COPY.en;
  if (noCandidates) return c.noCandidates;
  return c.aiFailed;
}
