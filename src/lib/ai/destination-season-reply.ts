import {
  logBestTravelMonth,
  logSeasonEvents,
  resolveDestinationEntity,
  type DestinationEntity,
} from "@/lib/ai/destination-entity";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

function buildEntityBestTimeLines(entity: DestinationEntity): string[] {
  const { name, seasonality, type, country } = entity;
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
    lines.push("", ...seasonality.notes);
  }

  lines.push("", "你這趟比較想偏重城市、自然風光，還是有特定活動（例如滑雪、賞楓、海島）？");
  return lines;
}

/** 通用最佳旅行時間回覆 — 不限制國家白名單 */
export function buildBestTravelTimeReply(destination: string): string {
  const entity = resolveDestinationEntity(destination);
  return buildEntityBestTimeLines(entity).join("\n");
}

export function buildBestTravelTimeReplyFromEntity(entity: DestinationEntity): string {
  return buildEntityBestTimeLines(entity).join("\n");
}
