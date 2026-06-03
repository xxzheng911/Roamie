import type { ChatPlanningSession } from "@/lib/chat-session";
import type { ClientContextBundle } from "@/lib/fetch-context";
import { formatDateRangeLabel } from "@/lib/picker-utils";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import type { LongTermMemorySnapshot } from "@/lib/ai/memory/types";
import { formatLongTermMemoryForPrompt } from "@/lib/ai/memory/long-term-memory";

export type PlusPlanConsultantStage = "outline" | "gathering" | "ready";

export type PlusPlanConsultantReply = {
  summary: string;
  stage: PlusPlanConsultantStage;
  startItinerary?: boolean;
};

const QUESTION_POOL: { key: string; text: string }[] = [
  { key: "must_visit", text: "有一定想去的景點嗎？" },
  { key: "must_eat", text: "有一定想吃的餐廳嗎？" },
  { key: "shopping", text: "有想逛的商圈嗎？" },
  { key: "cold", text: "怕冷嗎？（會影響戶外與夜間安排）" },
  { key: "walking", text: "怕走路嗎？（會影響每日景點數量）" },
  { key: "sunrise", text: "想安排日出嗎？" },
  { key: "night_view", text: "想安排夜景嗎？" },
  { key: "avoid", text: "有不想去的地方或類型嗎？" },
];

function nightsFromDays(days: number): number {
  return Math.max(1, days - 1);
}

export function buildPlusPlanConsultantOpening(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
  memory?: LongTermMemorySnapshot | null,
): string {
  const dest = formatTripLocationLabel(form.destination);
  const days = form.days;
  const nights = nightsFromDays(days);
  const styles = form.styles.slice(0, 4).join("、") || "依你的偏好";
  const dateLine =
    form.startDate && form.endDate
      ? formatDateRangeLabel(form.startDate, form.endDate, { withYear: true })
      : `約 ${days} 天`;

  const memoryLine = memory
    ? formatLongTermMemoryForPrompt(memory).trim().slice(0, 200)
    : "";

  const lines = [
    `這次我預計幫你安排：`,
    ``,
    `${days} 天${nights} 夜${dest}旅行`,
    dateLine ? `（${dateLine}）` : "",
    ``,
    `主要方向：`,
    ...(form.styles.length ? form.styles.map((s) => `- ${s}`) : [`- ${styles}`]),
    ``,
    memoryLine
      ? `我記得你之前比較喜歡：${memoryLine.split("\n")[0] ?? memoryLine}，這次會優先往這個方向安排。`
      : "",
    ``,
    `在開始安排前，我想再了解你幾個小問題。`,
    ``,
    QUESTION_POOL[0].text,
  ];
  return lines.filter((l) => l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
}

function userWantsToFinalizePlan(text: string): boolean {
  return /(開始安排|可以開始|沒有了|就這樣|直接排|生成行程|幫我排)/.test(text.trim());
}

export function extractPlanConsultantRequirementsFromText(text: string): string[] {
  const t = text.trim();
  if (!t || t.length < 2) return [];
  const found: string[] = [];
  if (/第\s*一\s*天|day\s*1/i.test(t) && /海雲台|景點|去/.test(t)) found.push(t);
  if (/(餐廳|吃|美食|烤肉|拉麵|壽司)/.test(t)) found.push(t);
  if (/(日出|日落|夜景|夕陽)/.test(t)) found.push(t);
  if (/(怕冷|怕熱|怕走路|不想|不要|避免)/.test(t)) found.push(t);
  if (/(商圈|購物|百貨|Outlet)/.test(t)) found.push(t);
  if (found.length === 0 && t.length >= 4 && !userWantsToFinalizePlan(t)) found.push(t);
  return found;
}

export function appendPlanConsultantRequirements(
  session: ChatPlanningSession,
  notes: string[],
): ChatPlanningSession {
  const prev = session.planConsultantRequirements ?? [];
  const merged = [...new Set([...prev, ...notes.map((n) => n.trim()).filter(Boolean)])];
  return {
    ...session,
    planConsultantRequirements: merged,
    updatedAt: new Date().toISOString(),
  };
}

export function buildPlanConsultantConstraintsText(session: ChatPlanningSession): string {
  const reqs = session.planConsultantRequirements ?? [];
  if (!reqs.length) return "";
  return `【使用者指定需求 — 必須遵守】\n${reqs.map((r) => `- ${r}`).join("\n")}`;
}

export function resolvePlusPlanConsultantReply(
  userText: string,
  session: ChatPlanningSession,
): PlusPlanConsultantReply | null {
  if (!session.planPlusConsultant) return null;

  const asked = new Set(session.planConsultantAskedKeys ?? []);
  const newNotes = extractPlanConsultantRequirementsFromText(userText);

  if (userWantsToFinalizePlan(userText)) {
    return {
      summary: "好，我根據剛才的偏好來排完整行程，稍等我一下～",
      stage: "ready",
      startItinerary: true,
    };
  }

  const answeredCount = asked.size;
  if (answeredCount >= 4) {
    return {
      summary:
        "我大概掌握你的需求了。若還想補充可以跟我說；或回覆「開始安排」，我就幫你排出完整行程。",
      stage: "gathering",
    };
  }

  const nextQ = QUESTION_POOL.find((q) => !asked.has(q.key));
  if (!nextQ) {
    return {
      summary: "若沒有其他想補充的，回覆「開始安排」，我就幫你生成完整行程。",
      stage: "gathering",
    };
  }

  const ack =
    newNotes.length > 0
      ? `好，我有記下來：${newNotes[0].slice(0, 60)}${newNotes[0].length > 60 ? "…" : ""}。\n\n`
      : "";

  return {
    summary: `${ack}${nextQ.text}`,
    stage: "gathering",
  };
}

export function markPlanConsultantQuestionAsked(
  session: ChatPlanningSession,
  userText: string,
): ChatPlanningSession {
  const asked = new Set(session.planConsultantAskedKeys ?? []);
  if (userText.trim().length >= 2) {
    const next = QUESTION_POOL.find((q) => !asked.has(q.key));
    if (next) asked.add(next.key);
  }
  return {
    ...session,
    planConsultantAskedKeys: [...asked],
    planConsultantStage: session.planConsultantStage === "outline" ? "gathering" : session.planConsultantStage,
    updatedAt: new Date().toISOString(),
  };
}
