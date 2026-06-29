import { localHourInTimeZone } from "@/lib/home-nearby-eligibility";

export type ExploreTimeBucket = "day" | "night" | "late_night";

/** 探索推薦快取時段（影響夜晚／深夜推薦比例） */
export function exploreTimeBucket(
  at = new Date(),
  timeZone = "Asia/Taipei",
): ExploreTimeBucket {
  const hour = localHourInTimeZone(at, timeZone);
  if (hour >= 22 || hour < 6) return "late_night";
  if (hour >= 18) return "night";
  return "day";
}

export function buildExploreSessionKey(parts: {
  locationKey: string;
  categoryId: string;
  locale: string;
  mode?: "city" | "nearby";
  timeBucket?: ExploreTimeBucket;
  freeTextQuery?: string | null;
}): string {
  const mode = parts.mode === "city" ? ":city" : "";
  const bucket =
    parts.mode === "city" ? "" : `:${parts.timeBucket ?? exploreTimeBucket()}`;
  if (parts.freeTextQuery?.trim()) {
    return `${parts.locationKey}:search:${parts.freeTextQuery.trim().toLowerCase()}:${parts.locale}${bucket}${mode}`;
  }
  return `${parts.locationKey}:${parts.categoryId}:${parts.locale}${bucket}${mode}`;
}
