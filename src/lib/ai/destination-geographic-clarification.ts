import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";
import { isTravelPlanningText } from "@/lib/ai/chat-intent-router";
import {
  isDestinationSelectionText,
  isFutureTripPlanningStatement,
  parseDestinationFromText,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";

export type PendingGeographicClarificationKind = "destination_area";

export type PendingGeographicClarificationParentIntent = "place_recommendation";

export type PendingGeographicClarificationRoute = "destination_category";

/**
 * Pending Place/category geographic clarification.
 * Reuses ChatPlanningSession — not a second chat state machine.
 */
export type PendingGeographicClarification = {
  kind: PendingGeographicClarificationKind;
  rawGeographicLabel: string;
  parentIntent: PendingGeographicClarificationParentIntent;
  categoryIntent: ChatPlaceCategoryIntent;
  originatingRoute: PendingGeographicClarificationRoute;
  originalUserText?: string;
};

export type RestoredPlaceClarification = {
  parentCity: string;
  area: string;
  destinationLabel: string;
  categoryIntent: ChatPlaceCategoryIntent;
  restoredUserText: string;
  searchScope: "area";
};

const CATEGORY_QUERY_TAIL: Record<ChatPlaceCategoryIntent, string> = {
  cafe: "有什麼咖啡廳推薦嗎",
  restaurant: "有什麼餐廳推薦嗎",
  shopping: "有什麼購物推薦嗎",
  attraction: "有什麼景點推薦嗎",
  night_market: "有什麼夜市推薦嗎",
  bar: "有什麼酒吧推薦嗎",
  indoor: "有什麼室內景點推薦嗎",
};

function stripClarificationAnswerNoise(text: string): string {
  return text
    .trim()
    .replace(/[？?！!。．…〜~\s]+$/g, "")
    .replace(/(?:的地區|地區|的那边|的那邊)$/u, "")
    .replace(/的$/u, "")
    .replace(/^(?:是|在)/u, "")
    .trim();
}

export function isPlaceClarificationTripPlanningOverride(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    isTravelPlanningText(t) ||
    isDestinationSelectionText(t) ||
    isFutureTripPlanningStatement(t)
  );
}

export function parseParentCityFromClarificationAnswer(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const stripped = stripClarificationAnswerNoise(t);
  return (
    resolveDestinationFromText(stripped) ??
    parseDestinationFromText(stripped) ??
    resolveDestinationFromText(t) ??
    parseDestinationFromText(t)
  );
}

function restoreUserText(
  pending: PendingGeographicClarification,
  parentCity: string,
): string {
  const area = pending.rawGeographicLabel.trim();
  const original = pending.originalUserText?.trim() ?? "";
  if (original && original.includes(area) && !original.includes(parentCity)) {
    return `${parentCity}${original}`;
  }
  if (original && original.includes(`${parentCity}${area}`)) {
    return original;
  }
  return `${parentCity}${area}${CATEGORY_QUERY_TAIL[pending.categoryIntent]}`;
}

export function restorePlaceIntentAfterGeographicClarification(
  pending: PendingGeographicClarification | undefined,
  answerText: string,
): RestoredPlaceClarification | null {
  if (!pending || pending.kind !== "destination_area") return null;
  if (pending.parentIntent !== "place_recommendation") return null;
  if (isPlaceClarificationTripPlanningOverride(answerText)) return null;

  const parentCity = parseParentCityFromClarificationAnswer(answerText);
  if (!parentCity) return null;
  const area = pending.rawGeographicLabel.trim();
  if (!area) return null;

  return {
    parentCity,
    area,
    destinationLabel: `${parentCity}${area}`,
    categoryIntent: pending.categoryIntent,
    restoredUserText: restoreUserText(pending, parentCity),
    searchScope: "area",
  };
}

export function buildPendingGeographicClarification(params: {
  rawGeographicLabel: string;
  categoryIntent: ChatPlaceCategoryIntent;
  originalUserText: string;
}): PendingGeographicClarification {
  return {
    kind: "destination_area",
    rawGeographicLabel: params.rawGeographicLabel,
    parentIntent: "place_recommendation",
    categoryIntent: params.categoryIntent,
    originatingRoute: "destination_category",
    originalUserText: params.originalUserText,
  };
}
