import type { ChatPlanningSession } from "@/lib/chat-session";
import {
  formatKnownInfoBlock,
  isReadyForPlanningConfirm,
  monthSeasonHint,
  nextGatheringField,
  resolveSessionDestination,
  shouldOrchestrateCompanion,
  syncConversationState,
  userWantsChatMore,
  userWantsPlanNow,
  type ConversationState,
} from "@/lib/ai/conversation-state";
import { isFlexiblePreferenceReply } from "@/lib/ai/flexible-preference";
import { extractKnownDestinationFromText } from "@/lib/ai/normalize-destination";

export type CompanionDialogueReply = {
  summary: string;
  source: "companion_dialogue";
  stage?: ConversationState["stage"];
  /** 顯示 [立即規劃] [再聊聊] */
  showConfirmChips?: boolean;
  /** 直接進入行程生成 */
  startItinerary?: boolean;
};

function buildAskPreferences(dest: string, days: number | undefined): string {
  const daysLine = days != null ? `${days} 天很剛好。\n\n` : "";
  return `${daysLine}這趟比較想：

- 放鬆散步
- 拍照打卡
- 美食探索
- 購物逛街

還是都有呢？`;
}

function buildAfterFlexible(state: ConversationState): string {
  const known = formatKnownInfoBlock(state);
  const prefLine = state.preferences.includes("flexible")
    ? "這次會是一個放鬆、美食、拍照都有的旅程。"
    : "";
  return `好，那我幫你抓一個比較均衡的節奏。

${known}
${prefLine ? `\n${prefLine}\n` : "\n"}
你是自己旅行，還是和朋友、家人一起呢？`;
}

function buildConfirmPrompt(state: ConversationState): string {
  const dest = state.destination ?? "這趟";
  const days = state.days ?? 3;
  const nights = Math.max(1, days - 1);
  return `我大概已經了解這趟旅行了。

${formatKnownInfoBlock(state)}

要不要我先幫你排一版
${days} 天${nights} 夜的${dest}行程？`;
}

function buildWelcomeDestination(dest: string): string {
  return `好耶～
想先了解一下這趟旅行：

你預計什麼時候去${dest}呢？`;
}

function buildAfterMonth(state: ConversationState): string {
  const dest = state.destination!;
  const hint = monthSeasonHint(dest, state.travelMonth);
  return `${hint || `${state.travelMonth}去${dest}很適合。`}

大概會安排幾天呢？`;
}

function buildAfterDays(state: ConversationState): string {
  return buildAskPreferences(state.destination!, state.days);
}

function buildAskCompanions(state: ConversationState): string {
  return `${formatKnownInfoBlock(state)}

你是自己旅行，還是和朋友、家人一起呢？`;
}

function buildAskField(field: ReturnType<typeof nextGatheringField>, state: ConversationState): string {
  switch (field) {
    case "destination":
      return "你想去哪裡玩呢？跟我說城市或國家就可以～";
    case "travelMonth":
      return state.destination
        ? `你預計什麼時候去${state.destination}呢？`
        : "你預計什麼時候出發呢？";
    case "days":
      return "大概會安排幾天呢？";
    case "preferences":
      return buildAskPreferences(state.destination ?? "這趟", state.days);
    case "companions":
      return buildAskCompanions(state);
    default:
      return buildConfirmPrompt(state);
  }
}

/**
 * 旅伴式對話回覆（不依賴 OpenAI，一次一問、記住上下文）
 */
export function resolveCompanionDialogueReply(
  userText: string,
  session: ChatPlanningSession,
): CompanionDialogueReply | null {
  if (!shouldOrchestrateCompanion(session)) return null;

  const state = session.conversationState;
  if (!state) return null;

  const t = userText.trim();
  if (!t) return null;

  if (userWantsPlanNow(t) && isReadyForPlanningConfirm(state)) {
    return {
      summary: "好，我來幫你整理一版行程～",
      source: "companion_dialogue",
      stage: "planning",
      startItinerary: true,
    };
  }

  if (userWantsChatMore(t)) {
    return {
      summary: "沒問題，我們慢慢聊～想調整目的地、天數或偏好都可以跟我說。",
      source: "companion_dialogue",
      stage: "gathering",
    };
  }

  if (isFlexiblePreferenceReply(t)) {
    if (state.destination && state.days != null && (state.travelMonth || state.travelDate)) {
      return {
        summary: buildAfterFlexible(state),
        source: "companion_dialogue",
        stage: "gathering",
      };
    }
  }

  const destInText = extractKnownDestinationFromText(t);
  if (destInText && /(玩|去|旅|想)/.test(t) && !state.travelMonth && state.days == null) {
    return {
      summary: buildWelcomeDestination(destInText),
      source: "companion_dialogue",
      stage: "gathering",
    };
  }

  if (/(\d{1,2})\s*月/.test(t) && state.destination && state.days == null) {
    const synced = { ...state, travelMonth: t.match(/(\d{1,2})\s*月/)?.[0] ?? state.travelMonth };
    return {
      summary: buildAfterMonth(synced),
      source: "companion_dialogue",
      stage: "gathering",
    };
  }

  if (/(\d+)\s*天/.test(t) && state.destination && !state.preferences.length) {
    const m = t.match(/(\d+)\s*天/);
    const days = m ? Number.parseInt(m[1], 10) : state.days;
    return {
      summary: buildAskPreferences(state.destination, days ?? state.days),
      source: "companion_dialogue",
      stage: "gathering",
    };
  }

  if (
    /(一個人|獨自|朋友|家人|情侶|女友|男友|伴侶|夫妻)/.test(t) &&
    isReadyForPlanningConfirm(state)
  ) {
    return {
      summary: buildConfirmPrompt(state),
      source: "companion_dialogue",
      stage: "confirming",
      showConfirmChips: true,
    };
  }

  if (isReadyForPlanningConfirm(state)) {
    return {
      summary: buildConfirmPrompt(state),
      source: "companion_dialogue",
      stage: "confirming",
      showConfirmChips: true,
    };
  }

  const missing = nextGatheringField(state);
  if (missing === "none") {
    return {
      summary: buildConfirmPrompt(state),
      source: "companion_dialogue",
      stage: "confirming",
      showConfirmChips: true,
    };
  }

  return {
    summary: buildAskField(missing, state),
    source: "companion_dialogue",
    stage: state.destination ? "gathering" : "discovering",
  };
}

/** 行程生成完成後的延續句 */
export function buildPostItineraryCompanionMessage(): string {
  return `如果想多安排咖啡廳、海景景點或購物行程，我也可以再幫你調整。`;
}
