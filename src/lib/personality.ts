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
    "「你喜歡在巷弄裡慢慢走，不喜歡被行程追著跑。我會幫你留一點點空白時間。」";
  if (type === "慢步療癒者") {
    impression = "「你需要的是能坐下來發呆的角落，不是打卡清單。我會幫你挑安靜、好待的地方。」";
  } else if (type === "城市探險家") {
    impression = "「你喜歡多看看、多走走，但還是希望節奏舒服。我會幫你串起有記憶點的路線。」";
  } else if (type === "悠閒生活家") {
    impression = "「你享受熱鬧，但不想要被趕場。我會幫你安排有生活感的市集與小店。」";
  } else if (type === "深度觀察者") {
    impression = "「你喜歡安靜裡的細節，書店、展覽、老宅都很適合你。」";
  }

  return { type, summary, impression };
}
