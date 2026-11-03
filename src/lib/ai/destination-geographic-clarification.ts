import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";
import { isTravelPlanningText } from "@/lib/ai/chat-intent-router";
import { analyzeContinueRecommendationStructure } from "@/lib/ai/continue-recommendation-intent";
import { resolveDestinationAlias } from "@/lib/ai/destination-alias-resolver";
import {
  classifyDestinationSwitchTurn,
  isDestinationSelectionText,
  isFutureTripPlanningStatement,
  normalizeDestinationLabel,
  parseDestinationFromText,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";

/**
 * - destination_area: parent-less geographic fragment; asks which city / region (existing flow).
 * - parent_city_scope: trusted parent city + unconfirmed tail; asks whether to search within
 *   the parent city. Only `confirmedParentCity` may ever become a search destination.
 * - destination_switch: more_places turn switching to a new destination whose provider
 *   validation failed; asks whether to switch. Only a confirmation intent, never geographic
 *   evidence: the confirmation turn re-validates the original sentence through the Authority.
 */
export type PendingGeographicClarificationKind =
  | "destination_area"
  | "parent_city_scope"
  | "destination_switch";

export type PendingGeographicClarificationParentIntent = "place_recommendation";

export type PendingGeographicClarificationRoute =
  | "destination_category"
  | "more_places"
  /** destination_switch created by an uncertain negated switch turn (no category request). */
  | "destination_update";

type PendingGeographicClarificationFields = {
  /** Clarification copy / logging only; never a search, geocode, weather or credits input. */
  rawGeographicLabel: string;
  parentIntent: PendingGeographicClarificationParentIntent;
  originatingRoute: PendingGeographicClarificationRoute;
  /** Original user sentence; kept only to preserve the request and for display. */
  originalUserText?: string;
  /** parent_city_scope only: Authority-confirmed parent city (the only searchable label). */
  confirmedParentCity?: string;
  /**
   * destination_switch only: the trusted destination at the turn start the pending was created
   * in. Context for copy / identity only; never proves that city is trusted.
   */
  previousConfirmedDestination?: string;
  /** destination_switch only: confirmation rounds used (integer 0–2, never decreases). */
  confirmationAttempts?: number;
};

/**
 * Pending Place/category geographic clarification.
 * Reuses ChatPlanningSession — not a second chat state machine.
 * categoryIntent is optional only for destination_switch (destination_update has none).
 */
export type PendingGeographicClarification = PendingGeographicClarificationFields &
  (
    | {
        kind: Exclude<PendingGeographicClarificationKind, "destination_switch">;
        categoryIntent: ChatPlaceCategoryIntent;
      }
    | { kind: "destination_switch"; categoryIntent?: ChatPlaceCategoryIntent }
  );

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
  return `${parentCity}${area}${categoryQueryTail(pending)}`;
}

/** Category request tail; destination_switch pendings may carry no category (none appended). */
function categoryQueryTail(pending: PendingGeographicClarification): string {
  return pending.categoryIntent ? CATEGORY_QUERY_TAIL[pending.categoryIntent] : "";
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

/** Existing parent + category request text (used when the original sentence cannot be). */
export function buildParentScopeCategoryUserText(
  pending: PendingGeographicClarification,
  confirmedParentCity: string,
): string {
  return `${confirmedParentCity}${categoryQueryTail(pending)}`;
}

export function buildPendingParentScopeClarification(params: {
  confirmedParentCity: string;
  rawGeographicLabel: string;
  categoryIntent: ChatPlaceCategoryIntent;
  originalUserText: string;
}): PendingGeographicClarification {
  return {
    kind: "parent_city_scope",
    rawGeographicLabel: params.rawGeographicLabel,
    parentIntent: "place_recommendation",
    categoryIntent: params.categoryIntent,
    originatingRoute: "destination_category",
    originalUserText: params.originalUserText,
    confirmedParentCity: params.confirmedParentCity,
  };
}

export type ParentScopeConfirmationAnswer = "confirm" | "decline" | "unresolved";

// Whole-answer yes / no tokens only (after trimming punctuation and polite particles).
// Anything else — including answers that merely contain these words — is unresolved.
const PARENT_SCOPE_CONFIRM =
  /^(?:好|好的|好啊|好呀|好喔|好哦|是|是的|對|对|對的|要|可以|沒問題|没问题|ok|okay|yes|yep|yeah|sure|please|はい|ええ|うん|お願いします|おねがいします|네|예|좋아요|응)$/iu;
const PARENT_SCOPE_DECLINE =
  /^(?:不|不要|不用|不用了|不是|不對|不对|否|no|nope|いいえ|いや|いらない|아니요|아니오|아니|아뇨)$/iu;

function stripConfirmationAnswerPunctuation(text: string): string {
  return text
    .trim()
    .replace(/[\s。．.！!？?、,，~〜…]+$/gu, "")
    .replace(/^[\s。．.！!？?、,，~〜…]+/gu, "")
    .trim();
}

function compactDestinationLabel(value: string): string {
  return normalizeDestinationLabel(value).replace(/[\s,，、/／-]+/g, "");
}

/**
 * The whole answer is exactly the parent city recorded on this pending (e.g.「京都」).
 * Compared only against `confirmedParentCity`; no other place names are recognised here.
 */
export function isParentScopeCityEchoAnswer(
  text: string,
  confirmedParentCity: string | undefined,
): boolean {
  const parent = confirmedParentCity?.trim();
  const answer = stripConfirmationAnswerPunctuation(text);
  if (!parent || !answer) return false;
  const compactParent = compactDestinationLabel(parent);
  return Boolean(compactParent) && compactDestinationLabel(answer) === compactParent;
}

export function parseParentScopeConfirmationAnswer(text: string): ParentScopeConfirmationAnswer {
  const t = stripConfirmationAnswerPunctuation(text);
  if (!t) return "unresolved";
  if (PARENT_SCOPE_CONFIRM.test(t)) return "confirm";
  if (PARENT_SCOPE_DECLINE.test(t)) return "decline";
  return "unresolved";
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

// ─────────────── destination_switch (more_places) ───────────────

/** Confirmation rounds per pending, including the creating turn (each round ≤ 1 validation). */
const DESTINATION_SWITCH_MAX_ATTEMPTS = 2;
/** Existing limits: place label (location.functions.ts) and chat input (service.server.ts). */
const DESTINATION_SWITCH_LABEL_MAX = 120;
const DESTINATION_SWITCH_TEXT_MAX = 4000;
/** Coordinates, search-scope wording or a distance: never part of a pending label / sentence. */
const DESTINATION_SWITCH_SCOPE_RE =
  /searchScope|radius|半徑|半径|範圍|范围|公里內|公里内|-?\d{1,3}\.\d{2,}\s*[,，、/]\s*-?\d{1,3}\.\d{2,}|\d+(?:\.\d+)?\s*(?:公里|公尺|千米|英里|米|km|mi|m)(?![a-z])/i;

type DestinationSwitchSessionView = {
  recommendationSession?: { destination?: string } | null;
  travelContext?: { destination?: string } | null;
};

/** Canonical identity of a place label (existing alias table: 金沢＝金澤). */
function destinationSwitchLabelKey(value: string | undefined): string {
  const text = value?.trim();
  if (!text) return "";
  return compactDestinationLabel(resolveDestinationAlias(text).normalizedName || text);
}

function sameDestinationSwitchLabel(a: string | undefined, b: string | undefined): boolean {
  const key = destinationSwitchLabelKey(a);
  return Boolean(key) && key === destinationSwitchLabelKey(b);
}

function isPendingCategoryIntent(value: unknown): value is ChatPlaceCategoryIntent {
  return typeof value === "string" && Object.hasOwn(CATEGORY_QUERY_TAIL, value);
}

/** Turn-start trusted destination: recommendationSession first, then travelContext. */
export function destinationSwitchTrustedPrevious(
  session: DestinationSwitchSessionView | undefined,
): string | undefined {
  return (
    session?.recommendationSession?.destination?.trim() ||
    session?.travelContext?.destination?.trim() ||
    undefined
  );
}

export function isDestinationSwitchPending(
  pending: PendingGeographicClarification | undefined | null,
): pending is PendingGeographicClarification {
  return Boolean(pending) && pending?.kind === "destination_switch";
}

/**
 * The only destination_switch shape (exactly these eight fields). Null when any field breaks the
 * contract: label / sentence limits, no coordinates or scope wording, the sentence still names
 * exactly this label for the Authority, label ≠ previous destination, attempts 0–2.
 */
function buildDestinationSwitchPending(params: {
  rawGeographicLabel: string | undefined;
  previousConfirmedDestination: string | undefined;
  categoryIntent: unknown;
  originalUserText: string | undefined;
  confirmationAttempts: number;
}): PendingGeographicClarification | null {
  const raw = params.rawGeographicLabel?.trim() ?? "";
  const previous = params.previousConfirmedDestination?.trim() ?? "";
  const original = params.originalUserText ?? "";
  const attempts = params.confirmationAttempts;
  if (!raw || raw.length > DESTINATION_SWITCH_LABEL_MAX || DESTINATION_SWITCH_SCOPE_RE.test(raw)) {
    return null;
  }
  if (!previous || sameDestinationSwitchLabel(raw, previous)) return null;
  if (!isPendingCategoryIntent(params.categoryIntent)) return null;
  if (!original.trim() || original.length > DESTINATION_SWITCH_TEXT_MAX) return null;
  if (!original.includes(raw) || DESTINATION_SWITCH_SCOPE_RE.test(original)) return null;
  const structure = analyzeContinueRecommendationStructure(original);
  if (!structure.isContinue || !sameDestinationSwitchLabel(structure.candidateText, raw)) {
    return null;
  }
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > DESTINATION_SWITCH_MAX_ATTEMPTS) {
    return null;
  }
  return {
    kind: "destination_switch",
    rawGeographicLabel: raw,
    previousConfirmedDestination: previous,
    categoryIntent: params.categoryIntent,
    originatingRoute: "more_places",
    originalUserText: original,
    confirmationAttempts: attempts,
    parentIntent: "place_recommendation",
  };
}

/**
 * more_places turn whose named new destination failed provider validation: the pending to save
 * (this turn's validation is its first round). Null when the turn named no new destination
 * (pure continuation, previous city, unnamed label) — the caller keeps its existing branch.
 */
export function planDestinationSwitchPending(params: {
  userText: string;
  requestedDestination: string | undefined;
  turnStartSession: DestinationSwitchSessionView | undefined;
  categoryIntent: unknown;
}): PendingGeographicClarification | null {
  if (!params.requestedDestination?.trim()) return null;
  const structure = analyzeContinueRecommendationStructure(params.userText);
  if (!structure.isContinue || !structure.hasPendingPlaceCandidate) return null;
  if (!sameDestinationSwitchLabel(structure.candidateText, params.requestedDestination)) {
    return null;
  }
  return buildDestinationSwitchPending({
    rawGeographicLabel: structure.candidateText,
    previousConfirmedDestination: destinationSwitchTrustedPrevious(params.turnStartSession),
    categoryIntent: params.categoryIntent,
    originalUserText: params.userText,
    confirmationAttempts: 1,
  });
}

/**
 * A stored pending rebuilt to the exact contract (extra Client fields dropped). Null when it is
 * not a valid destination_switch or its previous destination is not this turn's trusted one.
 */
export function sanitizeDestinationSwitchPending(
  pending: PendingGeographicClarification | undefined,
  trustedPrevious: string | undefined,
): PendingGeographicClarification | null {
  if (!pending || !isDestinationSwitchPending(pending)) return null;
  if (pending.parentIntent !== "place_recommendation") return null;
  if (pending.originatingRoute !== "more_places") return null;
  const previous = trustedPrevious?.trim();
  if (!previous || pending.previousConfirmedDestination?.trim() !== previous) return null;
  const attempts = pending.confirmationAttempts ?? 0;
  return buildDestinationSwitchPending({
    rawGeographicLabel: pending.rawGeographicLabel,
    previousConfirmedDestination: previous,
    categoryIntent: pending.categoryIntent,
    originalUserText: pending.originalUserText,
    confirmationAttempts: typeof attempts === "number" ? attempts : -1,
  });
}

/** All confirmation rounds used: keep as-is, no further validation or confirmation request. */
export function isDestinationSwitchCapped(pending: PendingGeographicClarification): boolean {
  return (pending.confirmationAttempts ?? 0) >= DESTINATION_SWITCH_MAX_ATTEMPTS;
}

/**
 * After a confirmation round's provider check: +1 only when the provider was actually asked and
 * failed (never beyond the cap, never decreasing). Cooldown / cached miss / no check → unchanged.
 */
export function advanceDestinationSwitchPending(
  pending: PendingGeographicClarification,
  validation: { providerOutcome?: string },
): PendingGeographicClarification {
  if (validation.providerOutcome !== "provider_attempted_failure") return pending;
  const attempts = pending.confirmationAttempts ?? 0;
  return {
    ...pending,
    confirmationAttempts: Math.min(DESTINATION_SWITCH_MAX_ATTEMPTS, attempts + 1),
  };
}

/** Confirmation questions per pending, including the creating turn's. */
const DESTINATION_SWITCH_MAX_INQUIRIES = 3;

/**
 * Whether this pending may ask its confirmation question once more. Derived from the visible
 * conversation (no extra pending field): the trailing assistant replies of this pending —
 * `inquiryText` (the question) and `followUpTexts` (its non-question replies) — are counted
 * back to the first other assistant reply. Capped pendings never ask again.
 */
export function canAskDestinationSwitchAgain(
  pending: PendingGeographicClarification,
  conversation: readonly { role: string; content?: string }[],
  inquiryText: string,
  followUpTexts: readonly string[],
): boolean {
  if (isDestinationSwitchCapped(pending)) return false;
  let asked = 0;
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const message = conversation[i];
    if (message.role !== "assistant" || !message.content) continue;
    if (message.content === inquiryText) asked += 1;
    else if (!followUpTexts.includes(message.content)) break;
  }
  return asked < DESTINATION_SWITCH_MAX_INQUIRIES;
}

export type DestinationSwitchAnswer = "confirm" | "keep_previous" | "cancel" | "replace" | "hold";

const DESTINATION_SWITCH_KEEP_LEAD_RE =
  /^(?:繼續|继续|還是|还是|維持|维持|保持|留在|keep|stay(?:\s+(?:in|with))?|continue(?:\s+with)?|stick\s+with)\s*/iu;
const DESTINATION_SWITCH_KEEP_TAIL_RE =
  /\s*(?:就好了|就好|好了|吧|のままで?(?:お願いします)?|に(?:します)?|で(?:お願いします)?|계속|그대로(?:요)?)$/u;
const DESTINATION_SWITCH_PREVIOUS_WORD_RE =
  /^(?:原本|原來|原来|之前|剛剛|刚刚|舊|旧)(?:的|那個|那个)?(?:城市|地方|目的地)?$|^(?:前の|元の|もとの)(?:ところ|場所|街)?$|^(?:원래|이전)(?:\s*(?:곳|도시))?$|^(?:the\s+)?(?:previous|original|old|same)(?:\s+(?:one|city|place|destination))?$/iu;

function isKeepPreviousAnswer(answer: string, trustedPrevious: string | undefined): boolean {
  if (trustedPrevious && sameDestinationSwitchLabel(answer, trustedPrevious)) return true;
  const lead = answer.match(DESTINATION_SWITCH_KEEP_LEAD_RE);
  const tail = answer.match(DESTINATION_SWITCH_KEEP_TAIL_RE);
  if (!lead && !tail) return false;
  const core = answer
    .slice(lead ? lead[0].length : 0, tail ? answer.length - tail[0].length : answer.length)
    .trim();
  if (!core) return false;
  if (DESTINATION_SWITCH_PREVIOUS_WORD_RE.test(core)) return true;
  return Boolean(trustedPrevious) && sameDestinationSwitchLabel(core, trustedPrevious);
}

/**
 * Answer to a destination_switch confirmation. Pure and lexical; decides no destination:
 * confirm → re-validate the pending sentence; keep_previous / cancel → clear, no search;
 * replace → another destination / trip request (existing flow); hold → keep waiting.
 */
export function classifyDestinationSwitchAnswer(
  text: string,
  rawGeographicLabel: string,
  trustedPrevious: string | undefined,
): DestinationSwitchAnswer {
  const answer = stripConfirmationAnswerPunctuation(text);
  if (!answer) return "hold";
  if (PARENT_SCOPE_DECLINE.test(answer)) return "cancel";
  if (isKeepPreviousAnswer(answer, trustedPrevious)) return "keep_previous";
  if (PARENT_SCOPE_CONFIRM.test(answer)) return "confirm";
  if (sameDestinationSwitchLabel(answer, rawGeographicLabel)) return "confirm";
  const structure = analyzeContinueRecommendationStructure(text);
  if (structure.isContinue) {
    if (!structure.hasPendingPlaceCandidate) return "hold";
    return sameDestinationSwitchLabel(structure.candidateText, rawGeographicLabel)
      ? "confirm"
      : "replace";
  }
  if (isPlaceClarificationTripPlanningOverride(answer)) return "replace";
  const named = parseParentCityFromClarificationAnswer(answer);
  if (!named) return "hold";
  if (sameDestinationSwitchLabel(named, rawGeographicLabel)) return "confirm";
  if (trustedPrevious && sameDestinationSwitchLabel(named, trustedPrevious)) return "keep_previous";
  return "replace";
}

// ─────────────── destination_switch (destination_update) ───────────────
// Separate from buildDestinationSwitchPending (more_places): an uncertain negated switch turn
// (「我不去了換金澤」) may only ask whether to switch. The label is a classify candidate, never
// a trusted destination; confirming re-runs the Destination Authority for it.

/**
 * The only destination_update shape (exactly these seven fields; no categoryIntent). Null when:
 * label / sentence limits or scope wording break, no previous trusted destination, label =
 * previous, attempts not an integer 0–2, or the sentence no longer classifies as an uncertain
 * switch without a negated place naming exactly this label.
 */
export function planDestinationUpdatePending(params: {
  rawGeographicLabel: string | undefined;
  previousConfirmedDestination: string | undefined;
  originalUserText: string | undefined;
  confirmationAttempts: number;
}): PendingGeographicClarification | null {
  const raw = params.rawGeographicLabel?.trim() ?? "";
  const previous = params.previousConfirmedDestination?.trim() ?? "";
  const original = params.originalUserText?.trim() ?? "";
  const attempts = params.confirmationAttempts;
  if (!raw || raw.length > DESTINATION_SWITCH_LABEL_MAX || DESTINATION_SWITCH_SCOPE_RE.test(raw)) {
    return null;
  }
  if (!previous || sameDestinationSwitchLabel(raw, previous)) return null;
  if (!original || original.length > DESTINATION_SWITCH_TEXT_MAX) return null;
  if (!original.includes(raw) || DESTINATION_SWITCH_SCOPE_RE.test(original)) return null;
  const turnSwitch = classifyDestinationSwitchTurn(original);
  if (
    turnSwitch.state !== "NEGATED_UNCERTAIN" ||
    turnSwitch.reason !== "no_negated_place" ||
    !sameDestinationSwitchLabel(turnSwitch.targetLabel, raw)
  ) {
    return null;
  }
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > DESTINATION_SWITCH_MAX_ATTEMPTS) {
    return null;
  }
  return {
    kind: "destination_switch",
    rawGeographicLabel: raw,
    previousConfirmedDestination: previous,
    originatingRoute: "destination_update",
    originalUserText: original,
    confirmationAttempts: attempts,
    parentIntent: "place_recommendation",
  };
}

/**
 * A stored destination_update pending rebuilt to the exact contract (extra Client fields
 * dropped). Null (→ expired) when it is not one, or its previous destination is not this turn's
 * trusted one (`trustedPrevious` = confirmed destination of the turn-start session).
 */
export function sanitizeDestinationUpdatePending(
  pending: PendingGeographicClarification | undefined | null,
  trustedPrevious: string | undefined,
): PendingGeographicClarification | null {
  if (!pending || !isDestinationSwitchPending(pending)) return null;
  if (pending.originatingRoute !== "destination_update") return null;
  if (pending.parentIntent !== "place_recommendation") return null;
  const previous = trustedPrevious?.trim();
  if (!previous || pending.previousConfirmedDestination?.trim() !== previous) return null;
  const attempts = pending.confirmationAttempts ?? 0;
  return planDestinationUpdatePending({
    rawGeographicLabel: pending.rawGeographicLabel,
    previousConfirmedDestination: previous,
    originalUserText: pending.originalUserText,
    confirmationAttempts: typeof attempts === "number" ? attempts : -1,
  });
}

export type DestinationUpdateAnswer = "confirm" | "cancel" | "replace" | "other";

// Whole-answer short tokens only (after trimming punctuation); anything longer is not one.
const DESTINATION_UPDATE_CONFIRM = /^(?:對|对|是|好|沒錯|没错|ok|可以)$/iu;
const DESTINATION_UPDATE_CANCEL = /^(?:取消|算了|不用|不要|不改了|維持|维持)$/u;

/**
 * Answer to a destination_update pending. Pure and lexical; decides no destination:
 * confirm → the caller re-validates rawGeographicLabel through the Authority (no search, no
 * credits); cancel → keep the previous destination; replace → this turn names another switch /
 * destination (handled by its own classification); other → pending consumed, existing flow.
 */
export function classifyDestinationUpdateAnswer(
  text: string,
  rawGeographicLabel?: string,
): DestinationUpdateAnswer {
  const answer = stripConfirmationAnswerPunctuation(text);
  if (!answer) return "other";
  if (DESTINATION_UPDATE_CONFIRM.test(answer)) return "confirm";
  if (DESTINATION_UPDATE_CANCEL.test(answer)) return "cancel";
  if (classifyDestinationSwitchTurn(answer).state === "CONFIRMED_SWITCH") return "replace";
  const named = parseDestinationFromText(answer);
  if (named && !sameDestinationSwitchLabel(named, rawGeographicLabel)) return "replace";
  return "other";
}
