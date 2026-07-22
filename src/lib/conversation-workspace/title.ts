import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";

const THEME_LABEL: Partial<Record<ChatPlaceCategoryIntent, string>> = {
  shopping: "購物行程",
  cafe: "咖啡行程",
  restaurant: "美食旅行",
  attraction: "經典景點",
  night_market: "夜市行程",
  bar: "夜生活行程",
  indoor: "室內景點",
};

/**
 * Workspace title priority:
 * 1. User custom title (caller preserves when titleCustom)
 * 2. destination + days + theme
 * 3. destination + 旅行規劃
 * 4. 新的旅行規劃
 *
 * Never use the raw user message as the title.
 */
export function buildWorkspaceTitle(params: {
  destination?: string | null;
  tripDays?: number | null;
  themeIntent?: ChatPlaceCategoryIntent | null;
  customTitle?: string | null;
  titleCustom?: boolean;
}): string {
  const custom = params.customTitle?.trim();
  if (params.titleCustom && custom) return custom;

  const dest = (params.destination ?? "").trim();
  if (!dest) return "新的旅行規劃";

  const days =
    params.tripDays != null && params.tripDays > 0 ? `${params.tripDays} 天` : "";
  const theme = params.themeIntent ? THEME_LABEL[params.themeIntent] : undefined;

  if (days && theme) return `${dest} ${days}${theme}`;
  if (days) return `${dest} ${days}旅行規劃`;
  if (theme) return `${dest} ${theme}`;
  return `${dest} 旅行規劃`;
}
