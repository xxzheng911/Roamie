import type { CanonicalTravelContext } from "@/lib/ai/travel-context";

/** 使用者明確在問「什麼時候最適合 / 哪個季節」— 才允許提多季節建議 */
const BEST_SEASON_QUESTION_RE =
  /(什麼時候最適合|什么时候最适合|什麼去比較好|什么去比较好|什麼去最好|什么去最好|哪個季節|哪个季节|哪一季|幾月去比較好|几月去比较好|何時去比較好|何时去比较好|最佳.{0,6}(?:時間|时间|季節|季节|月份)|推薦季節|推荐季节|櫻花季.{0,4}(?:什麼|何时|何時|幾月)|楓葉季.{0,4}(?:什麼|何时|何時|幾月)|楓紅.{0,4}(?:什麼|何时|何時|幾月)|花季是什麼時候)/;

const UNRELATED_SEASON_SNIPPETS_RE =
  /(3[～\-~]?4\s*月.{0,8}櫻花|10[～\-~]?11\s*月.{0,8}楓|櫻花季|楓紅期|賞楓|賞櫻)/g;

export function isBestSeasonQuestion(text: string): boolean {
  return BEST_SEASON_QUESTION_RE.test(text.trim());
}

export function hasUserSpecifiedTravelMonth(
  ctx: CanonicalTravelContext,
  userText?: string,
): boolean {
  const t = userText?.trim() ?? "";
  return Boolean(
    ctx.travelMonth?.trim() ||
      ctx.startDate?.trim() ||
      /下個月|下个月|下月|這個月|这个月|本月/.test(t) ||
      /\d{1,2}\s*月/.test(t),
  );
}

export function resolveTravelMonthLabel(
  ctx: CanonicalTravelContext,
  userText: string,
): string {
  const t = userText.trim();
  if (/下個月|下个月|下月/.test(t)) return "下個月";
  if (/這個月|这个月|本月/.test(t)) return "這個月";
  if (ctx.travelMonth?.trim()) return ctx.travelMonth.trim();
  return "這段時間";
}

export function parseMonthNumber(travelMonth?: string): number | undefined {
  if (!travelMonth?.trim()) return undefined;
  const m = travelMonth.match(/(\d{1,2})/);
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  return n >= 1 && n <= 12 ? n : undefined;
}

/** 已指定月份時，移除與該月份無關的櫻花／楓紅敘述 */
export function stripUnrelatedSeasonInfo(
  text: string,
  userMonth?: number,
  allowBestSeason = false,
): string {
  if (allowBestSeason || userMonth == null) return text;

  const isCherryMonth = userMonth === 3 || userMonth === 4;
  const isMapleMonth = userMonth === 10 || userMonth === 11;

  return text
    .split("\n")
    .filter((line) => {
      if (!isCherryMonth && /櫻花|賞櫻/.test(line)) return false;
      if (!isMapleMonth && /楓|賞楓/.test(line)) return false;
      return true;
    })
    .join("\n")
    .replace(UNRELATED_SEASON_SNIPPETS_RE, (match) => {
      if (/櫻花/.test(match) && !isCherryMonth) return "";
      if (/楓/.test(match) && !isMapleMonth) return "";
      return match;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
