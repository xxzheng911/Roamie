import { captureDateGenerationAction, type DateGenerationAction } from './date-generation-continuation';
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";
import { resolveSuggestedTripDates, type TripDateProvenance } from "./resolve-suggested-trip-dates";
import { resolveTripCreateDates } from "./resolve-trip-create-dates";

export type DateContinuation = {
  entry: "direct" | "selection" | "recommendation" | "persist";
  action?: DateGenerationAction;
  userText?: string;
  generationId?: string;
  recommendationOptions?: { excludePlaceIds?: string[]; rejectedPlaceNames?: string[]; forceRegenerate?: boolean; replacePreviousCards?: boolean; diagnosticEntryType?: "advice"; diagnosticTriggerItineraryGeneration?: boolean };
};
export type PendingTripDateConfirmation = {
  continuation: DateContinuation;
  proposed?: TripDateProvenance;
  acceptedReply?: string;
  workspaceId?: string;
  conversationId?: string;
  planningSessionId?: string;
};

export function prepareTripDateConfirmation(session: ChatPlanningSession, continuation: DateContinuation): ChatPlanningSession | null {
  const context = session.travelContext ?? { interests: [] };
  const dates = resolveTripCreateDates({context, session, days: context.days ?? session.tripDays ?? 1});
  // Selection's nested authority is authored by the explicit date picker, not session fallback.
  const selected = session.planningSelection?.dateAuthority;
  if (dates.datesConfirmed || (!context.dateProvenance && selected && selected.startDate === session.tripStartDate && selected.endDate === session.tripEndDate && !context.suggestedStartDate)) return null;
  const candidate = dates.startDate && dates.endDate ? {
    source: dates.source as TripDateProvenance["source"], confirmed: false,
    startDate: dates.startDate, endDate: dates.endDate,
  } : undefined;
  const proposed = validProposedDates(candidate) ? candidate : undefined;
  return {...session, phase: "ready", pendingQuestion: {
    type: "date_confirmation", options: proposed ? ["use_suggested_dates"] : [],
    dateConfirmation: {continuation: continuation.entry === "recommendation" ? {...continuation, action:captureDateGenerationAction(session)} : continuation, proposed, workspaceId:session.workspaceId, conversationId:session.conversationId, planningSessionId:session.planningSessionId},
  }};
}

export function tripDateConfirmationCopy(session: ChatPlanningSession, locale: Locale): string {
  const candidate = session.pendingQuestion?.dateConfirmation?.proposed;
  const proposed = validProposedDates(candidate) ? candidate : undefined;
  const base = translate(locale, proposed ? "nativeQa.confirmTripDates" : "nativeQa.exactTripDates", {days:session.travelContext?.days ?? session.tripDays ?? 1});
  return proposed ? `${base}\n\n${translate(locale, "nativeQa.suggestedTripDates", {start:proposed.startDate, end:proposed.endDate})}` : base;
}

// Shared lexical semantics, used only under a current date-confirmation authority.
// Require both a reference to the proposed dates and an affirmative action; no
// locale-specific dispatch, full-sentence allowlist, bare number, or generic yes.
function acceptsProposedDates(text: string): boolean {
  const t = text.normalize("NFKC").trim().toLowerCase();
  if (!t || t.length > 240 || /[?？]|\b(?:not|no|never|don['’]?t|cannot|can['’]?t|maybe|if|instead|change|different)\b|不|改成|換成|如果|ません|ない|無理|別の|変更|なら|かもしれ|안(?:\s|돼|되)|않|싫|말고|바꾸|다른|면/.test(t)) return false;
  const reference = /\b(?:suggested|proposed|those|these|that)\s+(?:travel\s+)?dates?\b|(?:建議|建议|這個|这个|這些|这些|該|该).{0,4}(?:日期|日程)|(?:提案|建議|その|この).{0,8}(?:日程|日付)|(?:추천|제안|그|이).{0,8}(?:날짜|일정)/.test(t);
  const acceptance = /\b(?:use|accept|proceed|go with|work|works|fine|okay|ok)\b|使用|接受|就照|照著|可以|沒問題|使[うい]|お願い|大丈夫|進め|사용|진행|할게|괜찮/.test(t);
  return reference && acceptance;
}

function validProposedDates(proposed?: TripDateProvenance): proposed is TripDateProvenance {
  if (!proposed || !["month_default", "ai_suggested"].includes(proposed.source)) return false;
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date + "T12:00:00Z")) && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
  return valid(proposed.startDate) && valid(proposed.endDate) && proposed.endDate >= proposed.startDate;
}
const CANCEL = /^(?:cancel|取消|キャンセル|취소)[.!。！]?$/i;
export function consumeTripDateConfirmation(session: ChatPlanningSession, text: string): {
  status:"confirmed"|"pending"|"cancelled"|"stale"; session:ChatPlanningSession; continuation?:DateContinuation;
} {
  const pending = session.pendingQuestion?.dateConfirmation;
  if (session.pendingQuestion?.type !== "date_confirmation" || !pending) return {status:"stale",session};
  if ((pending.workspaceId && pending.workspaceId !== session.workspaceId) || (pending.conversationId && pending.conversationId !== session.conversationId) || (pending.planningSessionId && pending.planningSessionId !== session.planningSessionId)) return {status:"stale",session};
  if (CANCEL.test(text.trim())) return {status:"cancelled",session:{...session,pendingQuestion:undefined}};
  const context = session.travelContext ?? {interests:[]};
  const explicit = resolveSuggestedTripDates({days:context.days ?? session.tripDays ?? 1,userText:text});
  const accepted = acceptsProposedDates(text) && validProposedDates(pending.proposed) ? pending.proposed : undefined;
  const authority: TripDateProvenance | undefined = explicit?.source === "user_date"
    ? {source:"user_date",confirmed:true,startDate:explicit.startDate,endDate:explicit.endDate}
    : accepted ? {...accepted,confirmed:true} : undefined;
  if (!authority) return {status:"pending",session};
  return {status:"confirmed",continuation:pending.continuation, session:{...session,
    pendingQuestion:undefined,
    lastResolvedPendingQuestion:{...session.pendingQuestion, dateConfirmation:{...pending, proposed:authority, acceptedReply:text.trim().toLocaleLowerCase("en")}},
    tripStartDate:authority.startDate,tripEndDate:authority.endDate,
    tripDays:explicit?.days ?? session.tripDays,
    travelContext:{...context,startDate:authority.startDate,endDate:authority.endDate,
      days:explicit?.days ?? context.days, dateProvenance:authority},
    ...(session.planningSelection ? {planningSelection:{...session.planningSelection,dateAuthority:{startDate:authority.startDate,endDate:authority.endDate,tripDays:explicit?.days ?? context.days ?? session.tripDays ?? 1}}} : {}),
  }};
}

/** A completed asynchronous generation cannot restore an older date/session snapshot. */
export function isCurrentTripDateSnapshot(snapshot: ChatPlanningSession, current: ChatPlanningSession): boolean {
  for (const key of ["workspaceId", "conversationId", "planningSessionId"] as const) {
    if (snapshot[key] && snapshot[key] !== current[key]) return false;
  }
  const a = snapshot.travelContext?.dateProvenance;
  const b = current.travelContext?.dateProvenance;
  return a?.startDate === b?.startDate && a?.endDate === b?.endDate &&
    a?.source === b?.source && a?.confirmed === b?.confirmed;
}

/** Consume a retransmitted acknowledgement without entering paid Chat or generation. */
export function isRepeatedTripDateConfirmation(session: ChatPlanningSession, text: string): boolean {
  if (session.pendingQuestion) return false;
  const receipt = session.lastResolvedPendingQuestion?.type === "date_confirmation"
    ? session.lastResolvedPendingQuestion.dateConfirmation : undefined;
  const authority = session.travelContext?.dateProvenance;
  return Boolean(receipt?.acceptedReply && (receipt.acceptedReply === text.trim().toLocaleLowerCase("en") ||
      (validProposedDates(receipt.proposed) && acceptsProposedDates(text))) &&
    authority?.confirmed && receipt.proposed?.startDate === authority.startDate &&
    receipt.proposed?.endDate === authority.endDate && receipt.proposed?.source === authority.source &&
    (!receipt.workspaceId || receipt.workspaceId === session.workspaceId) &&
    (!receipt.conversationId || receipt.conversationId === session.conversationId) &&
    (!receipt.planningSessionId || receipt.planningSessionId === session.planningSessionId));
}
