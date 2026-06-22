import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";

const FLEXIBLE_REPLY_RE =
  /^(都可以|都行|不限|沒特別|沒有特別|隨意|你推|都行吧|隨便|任何|沒有偏好|沒偏好)$/;

export type PendingQuestionType =
  | "trip_style_choice"
  | "region_choice"
  | "duration_choice"
  | "activity_choice";

export type PendingQuestion = {
  type: PendingQuestionType;
  options: string[];
  baseDestination?: string;
  destinationCountry?: string;
};

const AFFIRMATIVE_TAIL_RE =
  /(好像不錯|好像可以|蠻不錯|蛮不错|不錯|不错|可以|好的|好呀|挺好|就這個|就这个|選這個|选这个|好了|就用|就它|應該可以|应该可以)/;

const OPTION_ALIASES: Record<string, string[]> = {
  海灘放鬆: ["海灘放鬆", "海灘", "海邊放鬆", "海邊", "看海", "沙灘"],
  跳島: ["跳島", "離島", "島嶼"],
  水上市場: ["水上市場", "水上市集", "丹嫩莎多", "floating market"],
  "曼谷＋芭達雅": [
    "曼谷＋芭達雅",
    "曼谷+芭達雅",
    "曼谷和芭達雅",
    "曼谷跟芭達雅",
    "曼谷加芭達雅",
    "曼谷芭達雅",
    "曼谷、芭達雅",
  ],
  海島放鬆: ["海島放鬆", "海島", "海島度假"],
  城市美食: ["城市美食", "美食", "按摩", "夜市"],
  經典地標: ["經典地標", "地標", "必去景點"],
  慢步調散策: ["慢步調", "散策", "慢慢走", "慢旅行"],
};

function normalizeOptionText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, "")
    .replace(/\+/g, "＋")
    .toLowerCase();
}

function optionKeywords(option: string): string[] {
  const aliases = OPTION_ALIASES[option] ?? [option];
  return [...new Set([option, ...aliases])];
}

function textMatchesOption(text: string, option: string): boolean {
  const normalized = normalizeOptionText(text);
  for (const keyword of optionKeywords(option)) {
    const key = normalizeOptionText(keyword);
    if (normalized.includes(key)) return true;
  }
  return false;
}

export function parsePendingOptionSelection(
  text: string,
  pending: PendingQuestion,
): string | null {
  const t = text.trim();
  if (!t) return null;

  const sorted = [...pending.options].sort((a, b) => b.length - a.length);
  for (const option of sorted) {
    if (textMatchesOption(t, option)) return option;
  }

  const stripped = t.replace(AFFIRMATIVE_TAIL_RE, "").trim();
  if (stripped && stripped !== t) {
    for (const option of sorted) {
      if (textMatchesOption(stripped, option)) return option;
    }
  }

  if (FLEXIBLE_REPLY_RE.test(t) || AFFIRMATIVE_TAIL_RE.test(t)) {
    for (const option of sorted) {
      if (textMatchesOption(t, option)) return option;
    }
  }

  return null;
}

export function applyDestinationPendingSelection(
  text: string,
  session: ChatPlanningSession,
): {
  session: ChatPlanningSession;
  contextPatch: Partial<CanonicalTravelContext>;
  selectedOption?: string;
} {
  const pending = session.pendingQuestion;
  if (!pending) {
    return { session, contextPatch: {} };
  }

  const selected = parsePendingOptionSelection(text, pending);
  if (!selected) {
    return { session, contextPatch: {} };
  }

  const contextPatch = buildContextPatchForSelection(selected, pending);
  return {
    session: {
      ...session,
      pendingQuestion: undefined,
      adviceSelectionThisTurn: selected,
      lastResolvedPendingQuestion: pending,
    },
    contextPatch,
    selectedOption: selected,
  };
}

function buildContextPatchForSelection(
  selected: string,
  pending: PendingQuestion,
): Partial<CanonicalTravelContext> {
  const country = pending.destinationCountry;
  const base: Partial<CanonicalTravelContext> = {
    selectedTripStyle: selected,
    travelStyle: selected,
  };

  if (selected === "曼谷＋芭達雅") {
    return {
      ...base,
      destination: "曼谷＋芭達雅",
      destinationCountry: country ?? "泰國",
      destinationCities: ["曼谷", "芭達雅"],
      tripPurpose: "route_combination_selected",
    };
  }

  if (selected === "海灘放鬆" || selected === "跳島" || selected === "水上市場") {
    return {
      ...base,
      destination: pending.baseDestination ?? "芭達雅",
      destinationCountry: country ?? "泰國",
      tripPurpose: "trip_style_selected",
      vibe: selected,
    };
  }

  if (pending.type === "duration_choice") {
    const days = parseDayCountFromText(selected) ?? parseDayCountFromText(selected.replace(/\s/g, ""));
    return {
      ...base,
      days,
      tripPurpose: "duration_selected",
    };
  }

  return {
    ...base,
    destination: pending.baseDestination,
    destinationCountry: country,
    tripPurpose: "option_selected",
  };
}

export function buildNextStepAfterAdviceSelection(
  selected: string,
  pending: PendingQuestion,
  ctx: CanonicalTravelContext,
): { reply: string; pendingQuestion?: PendingQuestion } {
  if (selected === "曼谷＋芭達雅") {
    return {
      reply: [
        "曼谷＋芭達雅很適合排 5～6 天。",
        "我會建議前半段住曼谷，安排美食、按摩、夜市和水上市場；後半段去芭達雅放鬆、看海或跳島。",
        "你這趟比較想排幾天？我可以先幫你抓一版 4 天、5 天或 6 天的節奏。",
      ].join("\n"),
      pendingQuestion: {
        type: "duration_choice",
        options: ["4 天", "5 天", "6 天"],
        baseDestination: "曼谷＋芭達雅",
        destinationCountry: pending.destinationCountry ?? "泰國",
      },
    };
  }

  if (selected === "海灘放鬆") {
    return {
      reply: [
        `好，以${pending.baseDestination ?? "芭達雅"}為主，我會幫你排海灘放鬆路線。`,
        "通常 2～3 天可以安排沙灘、海景餐廳和傍晚散步，節奏不會太趕。",
        "你這趟大概幾天？想偏重度假村放空，還是每天換不同海灘？",
      ].join("\n"),
      pendingQuestion: {
        type: "duration_choice",
        options: ["2 天", "3 天", "4 天"],
        baseDestination: pending.baseDestination ?? "芭達雅",
        destinationCountry: pending.destinationCountry ?? "泰國",
      },
    };
  }

  if (selected === "跳島") {
    return {
      reply: [
        `好，${pending.baseDestination ?? "芭達雅"}附近有不少跳島選擇，通常會排半日或一日船程。`,
        "我會建議先抓 3～4 天，留 1～2 天給跳島，其餘時間在海灘或市區放鬆。",
        "你這趟大概幾天？",
      ].join("\n"),
      pendingQuestion: {
        type: "duration_choice",
        options: ["3 天", "4 天", "5 天"],
        baseDestination: pending.baseDestination ?? "芭達雅",
        destinationCountry: pending.destinationCountry ?? "泰國",
      },
    };
  }

  if (selected === "水上市場") {
    return {
      reply: [
        "水上市場通常會搭配曼谷或近郊半日遊最順。",
        "若你想專攻水上市場，我建議 2～3 天曼谷＋近郊，或 4 天曼谷＋芭達雅各排一段。",
        "你比較想排幾天？",
      ].join("\n"),
      pendingQuestion: {
        type: "duration_choice",
        options: ["2 天", "3 天", "4 天"],
        baseDestination: pending.baseDestination ?? "曼谷",
        destinationCountry: pending.destinationCountry ?? "泰國",
      },
    };
  }

  if (pending.type === "duration_choice") {
    const days = parseDayCountFromText(selected) ?? ctx.days;
    const dest = pending.baseDestination ?? ctx.destination ?? "這趟";
    return {
      reply: [
        `好，${dest}${days ? ` ${days} 天` : ""}的方向我記下來了。`,
        "接下來我可以幫你抓一版前後段節奏，或先從必去景點開始排。",
        "你比較想先定總天數節奏，還是先列出必去點？",
      ].join("\n"),
    };
  }

  return {
    reply: `好的，我會以「${selected}」幫你往下規劃。你這趟大概幾天？`,
    pendingQuestion: {
      type: "duration_choice",
      options: ["3 天", "4 天", "5 天"],
      baseDestination: pending.baseDestination ?? ctx.destination,
      destinationCountry: pending.destinationCountry ?? ctx.destinationCountry,
    },
  };
}

export function pendingQuestionForPattayaStyleChoice(
  destinationCountry = "泰國",
): PendingQuestion {
  return {
    type: "trip_style_choice",
    options: ["海灘放鬆", "跳島", "水上市場", "曼谷＋芭達雅"],
    baseDestination: "芭達雅",
    destinationCountry,
  };
}

export function inferPendingQuestionFromAdviceReply(
  reply: string,
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): PendingQuestion | undefined {
  if (reply.includes("海灘放鬆、跳島、水上市場，還是曼谷＋芭達雅")) {
    return pendingQuestionForPattayaStyleChoice(ctx.destinationCountry ?? "泰國");
  }

  if (reply.includes("4 天、5 天或 6 天")) {
    return {
      type: "duration_choice",
      options: ["4 天", "5 天", "6 天"],
      baseDestination: ctx.destination ?? session.travelContext?.destination,
      destinationCountry: ctx.destinationCountry,
    };
  }

  return undefined;
}
