import {
  BUDGET_MODE_LABELS,
  resolveBudgetMode,
  type TravelPreferences,
} from "@/lib/preferences-storage";

const paceLabel: Record<string, string> = { slow: "慢", medium: "中等", active: "想多看" };
const vibeLabel: Record<string, string> = { quiet: "安靜", either: "都可以", lively: "熱鬧" };
const avoidLabel: Record<string, string> = {
  crowds: "人潮",
  packed: "行程太滿",
  overload: "資訊過多",
};

export type PersonalityResult = {
  type: string;
  summary: string;
  impression: string;
};

export function derivePersonality(prefs: TravelPreferences): PersonalityResult {
  const pace = prefs.pace ?? "medium";
  const vibe = prefs.vibe ?? "either";
  const avoid = prefs.avoid?.[0];
  const budget = BUDGET_MODE_LABELS[resolveBudgetMode(prefs)];

  let type = "巷弄漫遊者";
  if (pace === "slow" && vibe === "quiet") type = "慢步療癒者";
  else if (pace === "active" && vibe === "lively") type = "城市探險家";
  else if (pace === "slow" && vibe === "lively") type = "悠閒生活家";
  else if (pace === "active" && vibe === "quiet") type = "深度觀察者";

  const summary = [
    `步調偏${paceLabel[pace]}`,
    `喜歡${vibeLabel[vibe]}的氛圍`,
    `預算${budget}`,
    avoid ? `想避開${avoidLabel[avoid] ?? avoid}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  let impression =
    "你喜歡在巷弄裡慢慢走，不喜歡被行程追著跑。我會幫你留一點點空白時間。";
  if (type === "慢步療癒者") {
    impression = "你需要的是能坐下來發呆的角落，不是打卡清單。我會幫你挑安靜、好待的地方。";
  } else if (type === "城市探險家") {
    impression = "你喜歡多看看、多走走，但還是希望節奏舒服。我會幫你串起有記憶點的路線。";
  } else if (type === "悠閒生活家") {
    impression = "你享受熱鬧，但不想要被趕場。我會幫你安排有生活感的市集與小店。";
  } else if (type === "深度觀察者") {
    impression = "你喜歡安靜裡的細節，書店、展覽、老宅都很適合你。";
  }

  return { type, summary, impression };
}

/** Roamie 夥伴語氣的測驗結果摘要（個人簡介用） */
export function buildCompanionSummary(prefs: TravelPreferences): string {
  if (!prefs.onboarded) return "";

  const pace = prefs.pace ?? "medium";
  const vibe = prefs.vibe ?? "either";
  const avoid = prefs.avoid?.[0];
  const budget = resolveBudgetMode(prefs);

  const paceLead =
    pace === "slow"
      ? "你似乎更喜歡慢節奏、有空氣感的旅行"
      : pace === "active"
        ? "你喜歡多走走看看，但仍希望行程留一點呼吸空間"
        : "你喜歡節奏剛好、不趕也不拖的旅程";

  const vibeTail =
    vibe === "quiet"
      ? "偏好散步、安靜角落與有情緒氛圍的地方"
      : vibe === "lively"
        ? "也喜歡有生活感、熱鬧但不至於太擠的場景"
        : "氣氛舒服、好待的地方都很適合你";

  const budgetNote =
    budget === "budget"
      ? "我會優先幫你找平價、在地、不踩雷的選擇"
      : budget === "luxury"
        ? "我也會記得你想好好享受、少一點將就"
        : budget === "quality"
          ? "我會幫你挑有質感、但不浮誇的體驗"
          : "我會幫你找剛剛好、自在的選擇";

  const avoidNote =
    avoid === "crowds"
      ? "人潮太多會讓你累，我會盡量避開太擠的時段與熱點"
      : avoid === "packed"
        ? "行程太滿會讓你疲憊，我會幫你留白"
        : avoid === "overload"
          ? "選擇太多會讓你發散，我會幫你收斂成剛好的份量"
          : null;

  return [paceLead, vibeTail, budgetNote, avoidNote].filter(Boolean).join("，") + "。";
}
