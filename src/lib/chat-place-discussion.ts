import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlaceItem } from "@/lib/chat-session";

/** 使用者點「跟 Roamie 聊這裡」時的意圖標記 */
export const PLACE_DISCUSSION_USER_INTENT = "talk_about_this_place" as const;

export function buildPlaceDiscussionUserLine(placeName: string): string {
  return `我想多聊聊「${placeName}」這個地點，適合什麼情境、怎麼安排，附近還能搭配什麼？`;
}

export function filterPlaceDiscussionRecommendations(
  items: RoamieRecommendationItem[] | undefined,
  focused: ChatPlaceItem | RoamieRecommendationItem,
): RoamieRecommendationItem[] {
  const list = items ?? [];
  if (!list.length) return [];

  const focusedName = (focused.placeName ?? focused.name).trim();
  const focusedId =
    ("placeId" in focused && focused.placeId?.trim()) ||
    focused.googlePlaceId?.trim() ||
    "";

  return list.filter((r) => {
    const name = (r.placeName ?? r.name).trim();
    if (focusedId && r.googlePlaceId?.trim() === focusedId) return false;
    if (name && focusedName && name === focusedName) return false;
    return true;
  });
}
