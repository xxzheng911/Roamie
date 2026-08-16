import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";

export type MoodPresentationProvenance =
  | "HOME_MOOD_ENTRY"
  | "USER_EXPLICIT_MOOD"
  | "CATEGORY_DERIVED"
  | "SYSTEM_SYNTHESIZED"
  | "SESSION_CONTEXT";

const DESTINATION_SHORTCUT_TAGS = new Set([
  "動漫購物",
  "美食咖啡",
  "經典景點",
  "美食文化",
  "自然風光",
  "商圈購物",
  "城市散策",
]);

const HOME_MOOD_LABELS = new Set([
  "想放空",
  "一個人",
  "下雨天",
  "深夜散步",
  "找咖啡",
  "看海",
]);

function isHomeMoodLabel(value: string | undefined): boolean {
  const mood = value?.trim();
  return Boolean(mood && HOME_MOOD_LABELS.has(mood));
}

function isHomeMoodSession(session: ChatPlanningSession | undefined): boolean {
  if (!session) return false;
  return Boolean(
    session.homeMoodShortcutEntry || session.fromMoodFlow || session.fromMoodCard,
  );
}

export function resolveMoodPresentationProvenance(
  session?: ChatPlanningSession,
  context?: CanonicalTravelContext,
): MoodPresentationProvenance {
  const travel = context ?? session?.travelContext;
  const selected = session?.selectedMood?.trim() || session?.mood?.trim();
  if (isHomeMoodSession(session) && selected && !DESTINATION_SHORTCUT_TAGS.has(selected)) {
    return "HOME_MOOD_ENTRY";
  }
  if (travel?.moodEvidenceSource === "HOME_MOOD_ENTRY") return "HOME_MOOD_ENTRY";
  if (travel?.moodEvidenceSource === "USER_MESSAGE") return "USER_EXPLICIT_MOOD";
  if (travel?.moodEvidenceSource === "CATEGORY_DERIVED") return "CATEGORY_DERIVED";
  if (travel?.moodEvidenceSource === "SESSION_CONTEXT") return "SESSION_CONTEXT";
  if (travel?.moodEvidenceSource === "SYSTEM_SYNTHESIZED") return "SYSTEM_SYNTHESIZED";
  const mood = selected || travel?.mood?.trim();
  if (mood && DESTINATION_SHORTCUT_TAGS.has(mood)) return "CATEGORY_DERIVED";
  if (isHomeMoodLabel(mood) && isHomeMoodSession(session)) return "HOME_MOOD_ENTRY";
  if (mood) return "SYSTEM_SYNTHESIZED";
  return "SYSTEM_SYNTHESIZED";
}

export function shouldDisplayMoodPresentation(
  session?: ChatPlanningSession,
  context?: CanonicalTravelContext,
): boolean {
  return resolveMoodPresentationProvenance(session, context) === "HOME_MOOD_ENTRY";
}

export function resolvePresentableMoodTag(
  session?: ChatPlanningSession,
  context?: CanonicalTravelContext,
): string {
  if (!shouldDisplayMoodPresentation(session, context)) return "";
  return (
    session?.selectedMood?.trim() ||
    session?.mood?.trim() ||
    context?.mood?.trim() ||
    ""
  );
}
