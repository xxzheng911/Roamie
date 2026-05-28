/** 從使用者訊息解析旅伴對話意圖（陪伴式，非問卷） */

export type ConversationIntent =
  | "tired"
  | "coffee"
  | "rain"
  | "walk"
  | "relax"
  | "night"
  | "solo"
  | "couple"
  | "friends"
  | "food"
  | "photo"
  | "indoor"
  | "outdoor"
  | "quiet"
  | "crowd_avoid";

export type ParsedConversationIntent = {
  intents: ConversationIntent[];
  moodLabel?: string;
  wantsRecommendations: boolean;
  isEmotional: boolean;
};

const INTENT_PATTERNS: Array<{ intent: ConversationIntent; re: RegExp }> = [
  { intent: "tired", re: /(累|疲|倦|沒力|不想動|好睏)/ },
  { intent: "coffee", re: /(咖啡|cafe|咖啡廳|茶館)/i },
  { intent: "rain", re: /(下雨|雨天|雨)/ },
  { intent: "walk", re: /(散步|走走|漫步|河濱|步道)/ },
  { intent: "relax", re: /(放空|放鬆|發呆|療癒|休息)/ },
  { intent: "night", re: /(夜景|晚上|深夜|夜間)/ },
  { intent: "solo", re: /(一個人|獨自|solo)/i },
  { intent: "couple", re: /(女友|男友|情侶|兩人)/ },
  { intent: "friends", re: /(朋友|閨蜜|同學)/ },
  { intent: "food", re: /(吃|美食|餐廳|拉麵|小吃|餓)/ },
  { intent: "photo", re: /(拍照|攝影|打卡|取景)/ },
  { intent: "indoor", re: /(室內|室內就好|躲雨)/ },
  { intent: "outdoor", re: /(室外|戶外|外面)/ },
  { intent: "quiet", re: /(安靜|靜|吵|人多)/ },
  { intent: "crowd_avoid", re: /(不想人多|人少|避開人潮)/ },
];

export function parseConversationIntent(text: string): ParsedConversationIntent {
  const t = text.trim();
  const intents: ConversationIntent[] = [];
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(t)) intents.push(intent);
  }

  const isEmotional = /(累|疲|心情|感覺|有點|不知道|不確定|放空|煩|壓力|還好)/.test(t);
  const wantsRecommendations =
    /(推薦|去哪|哪裡|幫我找|找幾|想去|有沒有)/.test(t) ||
    intents.includes("coffee") ||
    intents.includes("food") ||
    intents.includes("walk");

  let moodLabel: string | undefined;
  if (intents.includes("tired")) moodLabel = "今天有點累";
  else if (intents.includes("rain")) moodLabel = "下雨天";
  else if (intents.includes("coffee")) moodLabel = "找咖啡";
  else if (intents.includes("relax")) moodLabel = "想放空";
  else if (intents.includes("night")) moodLabel = "深夜散步";

  return { intents, moodLabel, wantsRecommendations, isEmotional };
}

/** 陪伴式對話應走真實 AI，不要用固定 clarify 模板 */
export function shouldUseCompanionAiReply(
  userText: string,
  session: { fromMoodFlow?: boolean; fromMoodCard?: boolean; fromPlanForm?: boolean },
): boolean {
  if (session.fromPlanForm) return false;
  if (session.fromMoodFlow || session.fromMoodCard) return true;

  const parsed = parseConversationIntent(userText);
  if (parsed.isEmotional) return true;
  if (parsed.intents.length > 0) return true;
  if (/(今天|現在|附近|這裡)/.test(userText) && userText.length < 48) return true;
  return false;
}

export function formatConversationIntentForAi(parsed: ParsedConversationIntent): string {
  if (!parsed.intents.length && !parsed.moodLabel) return "";
  const labels: Record<ConversationIntent, string> = {
    tired: "疲累、想慢一點",
    coffee: "咖啡廳、久坐",
    rain: "雨天、偏室內",
    walk: "散步、輕鬆走走",
    relax: "放空、休息",
    night: "夜景、晚上",
    solo: "一個人",
    couple: "情侶",
    friends: "朋友",
    food: "吃東西",
    photo: "拍照",
    indoor: "室內",
    outdoor: "戶外",
    quiet: "安靜",
    crowd_avoid: "避開人潮",
  };
  const parts = parsed.intents.map((i) => labels[i]);
  return `【使用者意圖】${parts.join("、")}${parsed.moodLabel ? `；心情：${parsed.moodLabel}` : ""}`;
}
