import type { Locale } from "@/lib/i18n/types";
import { displayDestinationForCopy } from "./destination-locale-aliases";
import {
  logBestTravelMonth,
  logSeasonEvents,
  resolveDestinationEntity,
  type DestinationEntity,
} from "@/lib/ai/destination-entity";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { parseMonthNumber, resolveTravelMonthLabel } from "@/lib/ai/season-response-guardrail";

type BestTimeReplyOptions = {
  skipFollowUpQuestion?: boolean;
  locale?: Locale;
};

function parseMonthRangeStart(range: string): number | undefined {
  const m = range.match(/(\d{1,2})\s*[～~\-—–]\s*(\d{1,2})/);
  if (m?.[1]) return Number.parseInt(m[1], 10);
  const single = range.match(/(\d{1,2})\s*月/);
  if (single?.[1]) return Number.parseInt(single[1], 10);
  return undefined;
}

function isMonthInBestRanges(month: number, ranges: string[]): boolean {
  return ranges.some((range) => {
    const m = range.match(/(\d{1,2})\s*[～~\-—–]\s*(\d{1,2})/);
    if (m?.[1] && m[2]) {
      const start = Number.parseInt(m[1], 10);
      const end = Number.parseInt(m[2], 10);
      if (start <= end) return month >= start && month <= end;
      return month >= start || month <= end;
    }
    const start = parseMonthRangeStart(range);
    return start != null && Math.abs(month - start) <= 1;
  });
}

function buildEntityBestTimeLines(
  entity: DestinationEntity,
  opts?: BestTimeReplyOptions,
): string[] {
  const { name, seasonality, type, country } = entity;
  const locale = opts?.locale ?? "zh-TW";
  if (locale !== "zh-TW") {
    const shown = displayDestinationForCopy(name, undefined, locale);
    const copy = {
      en: { title: `Travel timing for ${shown}:`, caveat: "These are general seasonal ranges; conditions vary by region and activity.", unknown: "I don’t have reliable seasonal ranges for this destination yet.", ask: "Which city or area and activities are you considering?" },
      ja: { title: `${shown}の旅行時期：`, caveat: "一般的な季節の目安です。地域や活動によって適した時期は異なります。", unknown: "この目的地の信頼できる季節情報はまだありません。", ask: "どの都市やエリアで、どのような活動を考えていますか？" },
      ko: { title: `${shown} 여행 시기:`, caveat: "일반적인 계절 참고 정보이며 지역과 활동에 따라 적합한 시기가 달라요.", unknown: "아직 이 목적지의 신뢰할 수 있는 계절 정보가 없어요.", ask: "어느 도시나 지역에서 어떤 활동을 생각하고 계세요?" },
    }[locale];
    const ranges = seasonality.bestMonthRanges.flatMap(range => {
      const numbers = range.match(/^(\d{1,2})(?:\s*[～~\-—–]\s*(\d{1,2}))?/);
      if (!numbers) return [];
      const months = [numbers[1], numbers[2]].filter(Boolean).map(Number);
      if (months.some(month => month < 1 || month > 12)) return [];
      return [months.map(month => new Intl.DateTimeFormat(locale, {month:"long", timeZone:"UTC"}).format(new Date(Date.UTC(2000, month - 1, 1)))).join("–")];
    });
    return [copy.title, ...ranges.map(range => `• ${range}`), ranges.length ? copy.caveat : copy.unknown, ...(!opts?.skipFollowUpQuestion ? [copy.ask] : [])];
  }
  const label = normalizeDestinationLabel(name);
  const displayName =
    type !== "country" && country && country !== label ? `${label}（${country}）` : label;

  const lines: string[] = [`${displayName}的最佳旅行時間：`];

  if (seasonality.bestMonthRanges.length) {
    lines.push(...seasonality.bestMonthRanges.map((range) => `• ${range}`));
    logBestTravelMonth(seasonality.bestMonthRanges);
  }

  if (seasonality.events.length) {
    logSeasonEvents(seasonality.events);
    const eventLine = seasonality.events.map((e) => e.label).join("、");
    lines.push(`• 特色時段：${eventLine}`);
  }

  if (seasonality.notes.length) {
    lines.push("", ...seasonality.notes.map((note) => `• ${note}`));
  }

  if (!opts?.skipFollowUpQuestion) {
    lines.push(
      "",
      "你這趟比較想偏重城市、自然風光，還是有特定活動（例如滑雪、賞楓、海島）？",
    );
  }

  return lines;
}

/** 通用最佳旅行時間回覆 — 不限制國家白名單 */
export function buildBestTravelTimeReply(
  destination: string,
  opts?: BestTimeReplyOptions,
): string {
  const entity = resolveDestinationEntity(destination);
  return buildEntityBestTimeLines(entity, opts).join("\n");
}

export function buildBestTravelTimeReplyFromEntity(
  entity: DestinationEntity,
  opts?: BestTimeReplyOptions,
): string {
  return buildEntityBestTimeLines(entity, opts).join("\n");
}

/** 已有 travelDate / travelMonth 時：評估該月份是否適合，不重複推薦月份清單 */
export function buildTravelDateAssessmentReply(
  destination: string,
  ctx: CanonicalTravelContext,
  userText?: string,
  locale: Locale = "zh-TW",
): string {
  const entity = resolveDestinationEntity(destination);
  const label = normalizeDestinationLabel(destination);
  const monthNum =
    parseMonthNumber(ctx.travelMonth) ??
    (ctx.startDate?.trim() ? Number.parseInt(ctx.startDate.slice(5, 7), 10) : undefined);
  const monthLabel =
    ctx.travelMonth?.trim() ||
    ctx.startDate?.trim() ||
    resolveTravelMonthLabel(ctx, userText ?? "");

  if (locale !== "zh-TW") {
    const shown = displayDestinationForCopy(destination, userText, locale);
    const month = monthNum && monthNum >= 1 && monthNum <= 12
      ? new Intl.DateTimeFormat(locale, {month:"long", timeZone:"UTC"}).format(new Date(Date.UTC(2000, monthNum - 1, 1))) : "";
    const recorded = {
      en: `I’ve noted ${shown}${month ? ` in ${month}` : ""}. Exact dates are only set when you provide them.`,
      ja: `${shown}${month ? `・${month}` : ""}の旅行として控えました。具体的な日付は指定いただいた場合のみ確定します。`,
      ko: `${shown}${month ? ` · ${month}` : ""} 여행으로 기억할게요. 정확한 날짜는 직접 지정하신 경우에만 확정해요.`,
    }[locale];
    return [recorded, buildBestTravelTimeReply(destination, {locale, skipFollowUpQuestion:true})].join("\n");
  }
  const lines: string[] = [];

  if (monthNum && monthNum >= 1 && monthNum <= 12) {
    const inBest = isMonthInBestRanges(monthNum, entity.seasonality.bestMonthRanges);
    lines.push(
      inBest
        ? `${label}${monthLabel ? `（${monthLabel}）` : ""}大致落在適合旅行的時段，可以安排。`
        : `${label}${monthLabel ? `（${monthLabel}）` : ""}可能不是最理想月份，但仍可安排，建議避開戶外長時間曝曬或準備雨具。`,
    );
    if (entity.seasonality.notes.length) {
      lines.push("", ...entity.seasonality.notes.slice(0, 2).map((note) => `• ${note}`));
    }
    return lines.join("\n");
  }

  lines.push(`${label}${monthLabel ? `（${monthLabel}）` : ""}的時段評估：`);
  if (entity.seasonality.notes.length) {
    lines.push("", ...entity.seasonality.notes.map((note) => `• ${note}`));
  }
  return lines.join("\n");
}
