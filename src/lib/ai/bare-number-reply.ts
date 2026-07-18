import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import { parseTravelDateRangeFromText } from "@/lib/ai/parse-travel-date-range";

/** Minimal pending shape — avoids circular import with destination-pending-question. */
export type BareNumberPendingQuestion = {
  type: string;
  options?: string[];
  expectedAnswerType?: string;
  conversationState?: string;
};

const FULLWIDTH_DIGIT_RE = /[０-９]/g;
const CN_NUMERAL_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** Pending types / aliases that mean "asking for trip duration (or date-or-duration)". */
const DAYS_PENDING_TYPES = new Set<string>([
  "ask_days",
  "duration_choice",
  "ask_date_or_duration",
  "ask_date_or_days",
]);

const COMBINATION_PENDING_TYPES = new Set<string>([
  "combination_choice",
  "select_combination",
]);

export type BareNumberResolvedAs =
  | "tripDays"
  | "companionCount"
  | "budget"
  | "combinationId"
  | "month"
  | "needs_date_or_days_clarification"
  | "unresolved";

export type BareNumberResolution = {
  value: number;
  resolvedAs: BareNumberResolvedAs;
  confidence: "high" | "medium" | "low";
  tripDays?: number;
  companionCount?: number;
  budget?: number;
  combinationId?: number;
  month?: number;
  clarificationReply?: string;
};

export type BareNumberPendingContext = {
  pendingQuestion?: BareNumberPendingQuestion | null;
  /** Alias / log label when pending type is ask_days but question was date-or-duration. */
  pendingQuestionAlias?: string;
  conversationStage?: string | null;
  tripDays?: number | null;
};

function normalizeDigits(text: string): string {
  return text.replace(FULLWIDTH_DIGIT_RE, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  );
}

/** True when the reply looks like a calendar day/date, not a duration. */
export function looksLikeCalendarDayReply(text: string): boolean {
  const t = normalizeDigits(text.trim()).replace(/\s+/g, "");
  if (!t) return false;
  if (/^\d{1,2}號$/.test(t)) return true;
  if (/^\d{1,2}月\d{1,2}(日|號)?$/.test(t)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(t)) return true;
  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(t)) return true;
  return false;
}

/**
 * Extract a single integer from a bare / near-bare reply.
 * Accepts ASCII/fullwidth digits and a single Chinese numeral (一～十).
 */
export function parseBareIntegerFromText(text: string): number | undefined {
  const raw = normalizeDigits(text.trim()).replace(/\s+/g, "");
  if (!raw) return undefined;

  // Soft duration hedges without unit: "大概3" / "差不多3" / "3左右" / "3吧"
  const hedge = raw.match(/^(?:大概|差不多|約|大约|大约)?(\d{1,2})(?:左右|吧|天左右)?$/);
  if (hedge?.[1]) {
    const n = Number.parseInt(hedge[1], 10);
    if (Number.isFinite(n)) return n;
  }

  if (/^\d{1,2}$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }

  if (CN_NUMERAL_MAP[raw] != null) {
    return CN_NUMERAL_MAP[raw];
  }

  return undefined;
}

function pendingTypeKey(
  pending?: BareNumberPendingQuestion | null,
  alias?: string,
): string | undefined {
  return alias ?? pending?.type;
}

/**
 * Contextual bare-number resolution — never guess outside pendingQuestion / stage.
 */
export function resolveBareNumberByPendingQuestion(
  value: number,
  context: BareNumberPendingContext,
): BareNumberResolution {
  const type = pendingTypeKey(context.pendingQuestion, context.pendingQuestionAlias);
  const stage = context.conversationStage ?? "";

  if (type && COMBINATION_PENDING_TYPES.has(type)) {
    return {
      value,
      resolvedAs: "combinationId",
      confidence: "high",
      combinationId: value,
    };
  }

  if (type === "ask_people" || context.pendingQuestion?.expectedAnswerType === "companion") {
    return {
      value,
      resolvedAs: "companionCount",
      confidence: "high",
      companionCount: value,
    };
  }

  if (type === "ask_budget" || context.pendingQuestion?.expectedAnswerType === "budget") {
    return {
      value,
      resolvedAs: "budget",
      confidence: "medium",
      budget: value,
    };
  }

  if (type === "ask_month") {
    if (value >= 1 && value <= 12) {
      return {
        value,
        resolvedAs: "month",
        confidence: "high",
        month: value,
      };
    }
    return { value, resolvedAs: "unresolved", confidence: "low" };
  }

  if (type === "ask_date") {
    return {
      value,
      resolvedAs: "needs_date_or_days_clarification",
      confidence: "high",
      clarificationReply: `你回的「${value}」是指 ${value} 號出發，還是想玩 ${value} 天？`,
    };
  }

  const askingDays =
    (type != null && DAYS_PENDING_TYPES.has(type)) ||
    stage === "COLLECTING_DATE_AND_DURATION" ||
    context.pendingQuestion?.expectedAnswerType === "days" ||
    context.pendingQuestion?.conversationState === "awaiting_days";

  if (askingDays) {
    if (value >= 1 && value <= 30) {
      return {
        value,
        resolvedAs: "tripDays",
        confidence: "high",
        tripDays: value,
      };
    }
    return { value, resolvedAs: "unresolved", confidence: "low" };
  }

  return { value, resolvedAs: "unresolved", confidence: "low" };
}

export function logBareNumberReplyReceived(
  value: number,
  context: BareNumberPendingContext,
): void {
  const pending =
    context.pendingQuestionAlias ??
    context.pendingQuestion?.type ??
    "none";
  logAiPipeline(
    "[BARE_NUMBER_REPLY_RECEIVED]",
    `value=${value}`,
    `pendingQuestion=${pending}`,
    `stage=${context.conversationStage ?? "unknown"}`,
  );
}

export function logBareNumberContextResolution(resolution: BareNumberResolution): void {
  logAiPipeline(
    "[BARE_NUMBER_CONTEXT_RESOLUTION]",
    `value=${resolution.value}`,
    `resolvedAs=${resolution.resolvedAs}`,
    `confidence=${resolution.confidence}`,
  );
}

/**
 * Parse trip days for ask_days / date-or-duration pending replies.
 * Priority: date range → duration with unit → bare integer 1–30.
 */
export function parseTripDaysFromPendingReply(
  text: string,
  context?: BareNumberPendingContext,
): {
  days?: number;
  startDate?: string;
  endDate?: string;
  source?: "date_range" | "duration_unit" | "bare_number_contextual";
  clarificationReply?: string;
} {
  const t = text.trim();
  if (!t) return {};

  // Calendar-looking replies under pure ask_date → clarify.
  if (context?.pendingQuestion?.type === "ask_date" || context?.pendingQuestionAlias === "ask_date") {
    const bare = parseBareIntegerFromText(t);
    if (bare != null && !looksLikeCalendarDayReply(t) && parseDayCountFromText(t) == null) {
      const resolution = resolveBareNumberByPendingQuestion(bare, {
        ...context,
        pendingQuestionAlias: "ask_date",
      });
      logBareNumberReplyReceived(bare, { ...context, pendingQuestionAlias: "ask_date" });
      logBareNumberContextResolution(resolution);
      return { clarificationReply: resolution.clarificationReply };
    }
  }

  if (looksLikeCalendarDayReply(t) && !parseDayCountFromText(t)) {
    // e.g. "3號" / "8/3" while asking date-or-duration — do not treat as tripDays.
    const bare = parseBareIntegerFromText(t.replace(/號.*$/, "").replace(/[\/\-].*$/, "")) ??
      parseBareIntegerFromText(t);
    if (bare != null) {
      logBareNumberReplyReceived(bare, {
        ...context,
        pendingQuestionAlias:
          context?.pendingQuestionAlias ??
          context?.pendingQuestion?.type ??
          "ask_date_or_duration",
      });
      logBareNumberContextResolution({
        value: bare,
        resolvedAs: "needs_date_or_days_clarification",
        confidence: "high",
      });
      return {
        clarificationReply: `你回的「${t}」是指出發日期，還是想玩幾天？可以回例如「3天」或「8/15-8/17」。`,
      };
    }
  }

  const range = parseTravelDateRangeFromText(t);
  if (range.days && range.days > 0) {
    return {
      days: range.days,
      startDate: range.startDate,
      endDate: range.endDate,
      source: "date_range",
    };
  }

  const withUnit = parseDayCountFromText(t);
  if (withUnit) {
    return { days: withUnit, source: "duration_unit" };
  }

  const bare = parseBareIntegerFromText(t);
  if (bare == null) return {};

  const pendingCtx: BareNumberPendingContext = {
    pendingQuestion: context?.pendingQuestion ?? {
      type: "ask_days",
      options: [],
    },
    pendingQuestionAlias:
      context?.pendingQuestionAlias ??
      (context?.pendingQuestion?.type === "ask_days" ? "ask_date_or_duration" : undefined),
    conversationStage: context?.conversationStage ?? "COLLECTING_DATE_AND_DURATION",
    tripDays: context?.tripDays,
  };

  logBareNumberReplyReceived(bare, pendingCtx);
  const resolution = resolveBareNumberByPendingQuestion(bare, pendingCtx);
  logBareNumberContextResolution(resolution);

  if (resolution.resolvedAs === "tripDays" && resolution.tripDays != null) {
    logAiPipeline(
      "[TRIP_DURATION_PARSED]",
      `raw=${t}`,
      `tripDays=${resolution.tripDays}`,
      "source=bare_number_contextual",
    );
    return { days: resolution.tripDays, source: "bare_number_contextual" };
  }

  if (resolution.resolvedAs === "needs_date_or_days_clarification") {
    return { clarificationReply: resolution.clarificationReply };
  }

  // Bare integer ≥ 31 while asking days — do not auto-resolve.
  if (bare > 30) {
    return {
      clarificationReply: `你回的「${bare}」比較像日期或別的數字。這趟大概想玩幾天？例如回「5天」或「8/15-8/17」。`,
    };
  }

  return {};
}
