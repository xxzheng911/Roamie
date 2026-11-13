import type { AdminActiveUser, AdminAnalyticsV1 } from "@/lib/admin/admin-analytics";

export type AdminAnalyticsPeriod = AdminAnalyticsV1["period"];

export const PERIOD_OPTIONS: Array<{
  value: AdminAnalyticsPeriod;
  label: string;
  title: string;
}> = [
  { value: "today", label: "今天", title: "今天" },
  { value: "7d", label: "7 天", title: "近 7 日" },
  { value: "30d", label: "30 天", title: "近 30 日" },
  { value: "all", label: "全部", title: "全部期間" },
];

export function periodTitle(period: AdminAnalyticsPeriod): string {
  return PERIOD_OPTIONS.find((option) => option.value === period)?.title ?? "近 30 日";
}

export function formatNumber(value: number): string {
  return value.toLocaleString("zh-TW");
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString("zh-TW", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** 今年內不顯示年份 */
export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("zh-TW", {
    ...(sameYear ? {} : { year: "numeric" as const }),
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function displayName(user: AdminActiveUser): string {
  return user.displayName?.trim() || "未命名使用者";
}

/** 保留 local part 前 2 碼（local part ≤ 2 碼時保留 1 碼），其餘以 *** 取代 */
export function maskEmail(email: string | null | undefined): string {
  // 空值或非字串不遮蔽；EmailCell 對空值另外顯示「無 Email」
  if (typeof email !== "string") return "";
  const at = email.lastIndexOf("@");
  const local = at >= 0 ? email.slice(0, at) : email;
  const domain = at >= 0 ? email.slice(at + 1) : "";
  const keep = local.length <= 2 ? 1 : 2;
  const masked = `${local.slice(0, keep)}***`;
  return domain ? `${masked}@${domain}` : masked;
}

const FEATURE_TYPE_LABELS: Record<string, string> = {
  PLACE_RECOMMENDATION: "AI 地點推薦",
  ITINERARY_GENERATION: "行程生成",
};

const RECOMMENDATION_FAMILY_LABELS: Record<string, string> = {
  cafe: "咖啡廳",
  coffee: "找咖啡",
  restaurant: "餐廳美食",
  shopping: "購物商圈",
  attraction: "景點",
  night_market: "夜市",
  bar: "酒吧",
  indoor: "室內景點",
  rainy: "下雨天",
  relax: "放鬆",
  late_night: "深夜散步",
  sea: "看海",
};

const SURFACE_LABELS: Record<string, string> = {
  home: "首頁",
  chat: "聊聊",
  explore: "探索",
  selection: "行程選點",
  favorites: "收藏",
  itinerary: "行程",
  map: "地圖",
};

const PROVIDER_LABELS: Record<string, string> = {
  tripcom: "Trip.com",
  trip: "Trip.com",
  agoda: "Agoda",
  booking: "Booking.com",
  klook: "Klook",
  kkday: "KKday",
};

export function featureTypeLabel(value: string): string {
  return FEATURE_TYPE_LABELS[value] ?? "其他";
}

export function surfaceLabel(value: string): string {
  return SURFACE_LABELS[value] ?? "其他";
}

export function providerLabel(value: string): string {
  return PROVIDER_LABELS[value] ?? "其他";
}

export function recommendationFamilyLabel(value: string): string {
  return RECOMMENDATION_FAMILY_LABELS[value] ?? "其他";
}

/** 依標籤合併（未知值統一併入「其他」），並依次數排序 */
export function mergeByLabel<T>(
  rows: T[],
  label: (row: T) => string,
  count: (row: T) => number,
): Array<{ label: string; count: number }> {
  const merged = new Map<string, number>();
  for (const row of rows) {
    const key = label(row);
    merged.set(key, (merged.get(key) ?? 0) + count(row));
  }
  return [...merged.entries()]
    .map(([key, value]) => ({ label: key, count: value }))
    .sort((a, b) => b.count - a.count);
}
