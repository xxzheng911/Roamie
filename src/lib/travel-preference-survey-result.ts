import { BUDGET_MODE_LABELS, resolveBudgetMode, type TravelPreferences } from "@/lib/preferences-storage";
import { derivePersonality } from "@/lib/personality";
import type { SurveyAnswers, SurveyResultProfile } from "@/lib/travel-preference-survey-types";

const paceLabel: Record<string, string> = { slow: "慢步", medium: "適中", active: "緊湊" };
const vibeLabel: Record<string, string> = { quiet: "安靜", either: "平衡", lively: "熱鬧" };
const companionshipLabel: Record<string, string> = {
  solo: "獨旅",
  couple: "兩人",
  friends: "朋友同行",
  family: "家人",
  flexible: "不一定",
};

function suitableDirectionsFor(answers: SurveyAnswers): string[] {
  const dirs: string[] = [];
  const interests = answers.interests ?? [];
  if (interests.some((t) => /美食|咖啡/.test(t))) dirs.push("巷弄小店、在地餐酒、咖啡甜點");
  if (interests.some((t) => /拍照|夜景/.test(t))) dirs.push("視野好的觀景點、光影漂亮的街道");
  if (interests.some((t) => /購物/.test(t))) dirs.push("生活感市集、選物小店");
  if (interests.some((t) => /自然|戶外/.test(t))) dirs.push("公園綠地、海邊步道、郊山輕健行");
  if (interests.some((t) => /藝文|展覽/.test(t))) dirs.push("美術館、獨立書店、文化街區");
  if (answers.vibe === "quiet") dirs.push("人少、好發呆的角落");
  if (answers.vibe === "lively") dirs.push("有市集或夜生活氛圍的區域");
  if (answers.pace === "slow") dirs.push("不必趕路的慢區域");
  if (dirs.length === 0) dirs.push("氣氛舒服、適合散步的街區");
  return dirs.slice(0, 4);
}

export function buildSurveyResultProfile(answers: SurveyAnswers): SurveyResultProfile {
  const prefs: TravelPreferences = {
    pace: answers.pace ?? "medium",
    vibe: answers.vibe ?? "either",
    budgetMode: answers.budgetMode,
    interests: answers.interests ?? [],
    companionship: answers.companionship,
    onboarded: true,
  };
  const personality = derivePersonality(prefs);
  const budget = BUDGET_MODE_LABELS[resolveBudgetMode(prefs)];
  const pace = paceLabel[prefs.pace ?? "medium"];
  const vibe = vibeLabel[prefs.vibe ?? "either"];
  const companion = answers.companionship
    ? companionshipLabel[answers.companionship]
    : "彈性";

  const preferenceTypes = [
    `步調：${pace}`,
    `氛圍：${vibe}`,
    `預算：${budget}`,
    `同行：${companion}`,
    ...(answers.interests?.length ? [`興趣：${answers.interests.join("、")}`] : []),
  ];

  const travelTags = Array.from(
    new Set([
      ...(answers.interests ?? []),
      pace,
      vibe,
      budget,
      companion,
    ]),
  ).slice(0, 8);

  const suitableDirections = suitableDirectionsFor(answers);

  const recommendedStyle =
    answers.pace === "slow"
      ? "留白很多的慢旅行，重感受勝過打卡"
      : answers.pace === "active"
        ? "動線清楚、景點有記憶點的探索型旅程"
        : "節奏剛好、不趕也不拖的自在路線";

  const aiRecommendationSummary = [
    `你是「${personality.type}」`,
    `偏好${pace}、${vibe}氛圍，預算${budget}`,
    answers.companionship === "flexible"
      ? "同行人數還不確定時，我會優先安排一個人也舒服、和朋友同行也合適的彈性地點"
      : answers.companionship === "solo"
        ? "獨旅時我會幫你挑安全、好待、不會太擠的地點"
        : answers.companionship === "family"
          ? "和家人一起時我會避開太陡、太擠的路線"
          : answers.companionship === "friends"
            ? "和朋友同行我會安排有話題、好聚會的場景"
            : "兩人旅行我會多留浪漫、好拍照的選項",
    answers.interests?.length
      ? `興趣偏向：${answers.interests.join("、")}`
      : null,
    `適合方向：${suitableDirections[0] ?? "城市散步"}`,
  ]
    .filter(Boolean)
    .join("。");

  console.info("[SURVEY] resultGenerated=", personality.type);

  return {
    personalityType: personality.type,
    personalitySummary: personality.summary,
    personalityImpression: personality.impression,
    travelStyle: personality.type,
    preferenceTypes,
    recommendedStyle,
    suitableDirections,
    aiRecommendationSummary,
    travelTags,
  };
}

export function surveyAnswersToTravelPreferences(
  answers: SurveyAnswers,
  result: SurveyResultProfile,
): TravelPreferences {
  return {
    pace: answers.pace,
    vibe: answers.vibe,
    budgetMode: answers.budgetMode,
    interests: answers.interests,
    companionship: answers.companionship,
    onboarded: true,
    surveyCompleted: true,
    surveyCompletedAt: new Date().toISOString(),
    personalityType: result.personalityType,
    personalitySummary: result.aiRecommendationSummary,
    resultProfile: result,
  };
}
