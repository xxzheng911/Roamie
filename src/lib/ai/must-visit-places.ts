import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeRecommendationItem } from "@/lib/ai/types";
import {
  normalizeDestinationLabel,
  parseDestinationFromText,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import {
  isGenericPlaceLabel,
  INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
} from "@/lib/ai/generic-place-label";
import { parseItineraryPlanModeIntent } from "@/lib/ai/itinerary-planning";
import { classifyDestinationForPlaceSearch } from "@/lib/ai/landmark-place-strategy";
import {
  planningStageAfterMustVisitIntent,
  planningStageAfterRecommendations,
} from "@/lib/ai/chat-planning-stage";
import { isAffirmativeReply } from "@/lib/ai/chat-conversation-state";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";

export type PlanningFollowUpIntent = "must_visit_places" | "daily_rhythm" | "full_itinerary";

export type MustVisitPlace = {
  name: string;
  reason: string;
};

type DestinationMustVisitGuide = {
  places: MustVisitPlace[];
  rhythmTip?: string;
};

const MUST_VISIT_RE =
  /(必去點|必去景點|必去|推薦景點|哪些景點|列景點|列出景點|景點有哪些|景點推薦|幫我列|先列|有哪些地方值得去|值得去|幫我安排地點|直接推薦|幫我列出景點)/;

const PLACE_RECOMMENDATION_RE =
  /(推薦.{0,6}(?:景點|地點|地方)|哪些.{0,6}(?:景點|地點|地方)|列出.{0,6}(?:景點|地點)|有什麼.{0,4}(?:景點|地方)|去哪裡玩|去哪玩|必去)/;

const DAILY_RHYTHM_RE =
  /(總天數節奏|天數節奏|排節奏|先定節奏|前後段節奏|行程節奏|每天怎麼排|怎麼排天)/;

const DESTINATION_MUST_VISIT: Record<string, DestinationMustVisitGuide> = {
  阿里山: {
    places: [
      { name: "奮起湖老街", reason: "下山順路排便當、森林鐵路與老街小吃" },
      { name: "檜意森活村", reason: "嘉義市區文創聚落，適合慢逛拍照" },
      { name: "文化路夜市", reason: "嘉義在地小吃集中，晚餐好排" },
      { name: "太平雲梯", reason: "高空步道與茶園景觀，可當半日搭配" },
      { name: "北門驛", reason: "阿里山森林鐵路起點，復古車站很好拍" },
    ],
    rhythmTip: "若只有 1～2 天，建議第一天下午上山、隔日清晨看日出，再排奮起湖或嘉義市區。",
  },
  台北101: {
    places: [
      { name: "象山", reason: "經典夜景與台北 101 同框取景點" },
      { name: "松山文創園區", reason: "文創市集與展覽，適合半日慢逛" },
      { name: "國父紀念館", reason: "信義區綠地與換衛儀式，可串連商圈" },
      { name: "饒河夜市", reason: "在地小吃與河岸散步" },
      { name: "信義商圈", reason: "購物、美食與夜間氛圍" },
    ],
    rhythmTip: "101 周邊建議傍晚起排，象山夜景與夜市可接在一起。",
  },
  嘉義: {
    places: [
      { name: "檜意森活村", reason: "舊林業宿舍改建的文創聚落，適合慢逛拍照" },
      { name: "嘉義公園", reason: "市區綠地，可串連射日塔與市立博物館" },
      { name: "文化路夜市", reason: "在地小吃集中，晚餐與宵夜都好排" },
      { name: "蘭潭風景區", reason: "環湖散步、看夕陽的市區綠洲" },
      { name: "北門驛", reason: "阿里山森林鐵路起點，復古車站很好拍" },
      { name: "阿里山森林鐵路車庫園區", reason: "蒸汽火車與車庫展示，鐵道迷別錯過" },
    ],
    rhythmTip: "市區景點與森林鐵路可排半天，若要上阿里山建議另留 1～2 天。",
  },
  日月潭: {
    places: [
      { name: "玄光寺碼頭", reason: "環湖經典起點，可搭船串連各碼頭" },
      { name: "伊達邵部落", reason: "原民文化、茶葉蛋與纜車站" },
      { name: "向山觀景台", reason: "俯瞰日月潭全景，拍照效果好" },
      { name: "文武廟", reason: "湖畔地標，順路了解在地信仰文化" },
      { name: "九族文化村", reason: "親子或想加主題體驗時可排半日" },
    ],
    rhythmTip: "建議至少留 1 晚，清晨環湖或騎行體驗最佳。",
  },
  京都: {
    places: [
      { name: "伏見稻荷大社", reason: "千本鳥居經典，建議一早前往避開人潮" },
      { name: "清水寺", reason: "世界遺產，可連通二年坂、三年坂散步" },
      { name: "嵐山竹林小徑", reason: "竹林與渡月橋，適合半日慢遊" },
      { name: "金閣寺", reason: "標誌性金色建築，上午光線較好" },
      { name: "錦市場", reason: "在地小吃與伴手禮，適合晚餐前後" },
    ],
    rhythmTip: "東山、嵐山分兩天排會比較不趕。",
  },
  大阪: {
    places: [
      { name: "大阪城公園", reason: "城市地標，春天櫻花季特別熱門" },
      { name: "道頓堀", reason: "美食與夜景核心，適合晚上" },
      { name: "通天閣＋新世界", reason: "復古街區與炸串，拍照感強" },
      { name: "環球影城", reason: "若喜歡主題樂園可留一整日" },
      { name: "黑門市場", reason: "海鮮與小吃，適合午餐" },
    ],
    rhythmTip: "市區景點與美食可混搭，環球影城建議獨立一天。",
  },
  富士山: {
    places: [
      { name: "河口湖", reason: "經典富士山倒影取景點" },
      { name: "新倉山浅間公園", reason: "忠靈塔＋富士山同框" },
      { name: "忍野八海", reason: "湧泉聚落，適合短停" },
      { name: "箱根", reason: "溫泉與芦ノ湖，可排二日一夜" },
      { name: "大石公園", reason: "河口湖北岸視野開闊的富士展望點" },
    ],
    rhythmTip: "天氣好時河口湖與新倉山必排；陰天可改箱根溫泉。",
  },
  東京: {
    places: [
      { name: "淺草寺＋晴空塔", reason: "傳統與現代地標一次看完" },
      { name: "明治神宮＋原宿表參道", reason: "神社綠意接時尚商圈" },
      { name: "上野公園＋博物館", reason: "文化與櫻花季熱點" },
      { name: "澀谷＋新宿", reason: "購物、美食與夜景" },
      { name: "鎌倉一日遊", reason: "大佛、江之電與海景，適合近郊" },
    ],
    rhythmTip: "市區經典與近郊分開排，節奏會比較舒服。",
  },
  首爾: {
    places: [
      { name: "景福宮＋北村韓屋村", reason: "韓式傳統建築與巷弄散步" },
      { name: "弘大／梨大商圈", reason: "年輕文化、咖啡與逛街" },
      { name: "明洞", reason: "購物與韓式小吃集中" },
      { name: "南山首爾塔", reason: "夜景與城市全景" },
      { name: "廣藏市場", reason: "道地小吃，適合午餐" },
    ],
    rhythmTip: "前幾天排經典，後段留商圈與咖啡廳慢逛。",
  },
  曼谷: {
    places: [
      { name: "大皇宮＋玉佛寺", reason: "曼谷最經典寺廟組合" },
      { name: "鄭王廟", reason: "河對岸地標，適合傍晚" },
      { name: "恰圖恰市集", reason: "週末市集，可挖寶與小吃" },
      { name: "ICONSIAM", reason: "河畔商場，可搭船順遊" },
      { name: "喬德夜市", reason: "美食與夜生活" },
    ],
    rhythmTip: "寺廟、市集、夜市分天排，不會太趕。",
  },
  清邁: {
    places: [
      { name: "清邁古城寺廟", reason: "步行即可串連多座寺廟" },
      { name: "帕辛寺", reason: "古城內重要蘭納寺廟" },
      { name: "雙龍寺", reason: "素貼山俯瞰清邁" },
      { name: "週六／週日夜市", reason: "在地小吃與手作" },
      { name: "尼曼路", reason: "咖啡與文青小店" },
    ],
    rhythmTip: "古城散步、市集、近郊可各排一天。",
  },
  芭達雅: {
    places: [
      { name: "真理寺", reason: "木造建築藝術，海邊很壯觀" },
      { name: "芭達雅海灘", reason: "市區海灘散步與水上活動" },
      { name: "四方水上市場", reason: "特色市集，適合半日" },
      { name: "珊瑚島", reason: "跳島浮潛與沙灘" },
      { name: "中天海灘", reason: "較安靜，適合看日落" },
    ],
    rhythmTip: "海灘放鬆與跳島分開排較佳。",
  },
  普吉島: {
    places: [
      { name: "芭東海灘", reason: "最熱鬧的海灘與夜生活" },
      { name: "普吉老城", reason: "中葡建築與咖啡小店" },
      { name: "查龍寺", reason: "普吉最大佛寺" },
      { name: "神仙半島", reason: "南端日落展望" },
      { name: "皮皮島", reason: "經典跳島一日遊" },
    ],
    rhythmTip: "前段跳島、後段海灘放空較平衡。",
  },
};

/** 使用者明確要求必去景點／必去點 */
export function detectMustVisitIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return MUST_VISIT_RE.test(t);
}

/** 使用者要求推薦景點／列出地點（含「有哪些值得去」） */
export function detectPlaceRecommendationIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return PLACE_RECOMMENDATION_RE.test(t) || MUST_VISIT_RE.test(t);
}

export function parseMustVisitPlacesIntent(text: string): boolean {
  return detectMustVisitIntent(text) || detectPlaceRecommendationIntent(text);
}

export function parseDailyRhythmIntent(text: string): boolean {
  return DAILY_RHYTHM_RE.test(text.trim());
}

export function parsePlanningFollowUpIntent(text: string): PlanningFollowUpIntent | null {
  const t = text.trim();
  if (!t) return null;
  if (detectMustVisitIntent(t) || detectPlaceRecommendationIntent(t)) return "must_visit_places";
  if (parseItineraryPlanModeIntent(t) === "full_itinerary") return "full_itinerary";
  if (parseDailyRhythmIntent(t)) return "daily_rhythm";
  return null;
}

function parseDestinationForMustVisit(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const leading = t.match(
    /^([\u4e00-\u9fff]{2,10})(?:的)?(?:必去點|必去景點|必去|推薦景點|有哪些|列景點|列出景點|值得去)/,
  );
  if (leading?.[1]) {
    const fromLeading = parseDestinationFromText(leading[1]);
    if (fromLeading) return fromLeading;
  }

  return parseDestinationFromText(t);
}

export function resolveMustVisitDestination(
  ctx: CanonicalTravelContext,
  userText?: string,
): string | undefined {
  const fromCtx =
    ctx.destination?.trim() ||
    ctx.destinationCities?.[0]?.trim() ||
    undefined;
  if (fromCtx) return normalizeDestinationLabel(fromCtx);
  if (!userText?.trim()) return undefined;
  const parsed = parseDestinationForMustVisit(userText);
  if (parsed) return normalizeDestinationLabel(parsed);
  const embedded = resolveDestinationFromText(userText);
  return embedded ? normalizeDestinationLabel(embedded) : undefined;
}

function resolveGuide(destination: string): DestinationMustVisitGuide | null {
  const label = normalizeDestinationLabel(destination);
  if (DESTINATION_MUST_VISIT[label]) return DESTINATION_MUST_VISIT[label];

  if (label.includes("曼谷")) return DESTINATION_MUST_VISIT["曼谷"];
  if (label.includes("普吉")) return DESTINATION_MUST_VISIT["普吉島"];

  return null;
}

export function getMustVisitPlacesForDestination(destination: string): MustVisitPlace[] {
  const guide = resolveGuide(destination);
  if (guide) return guide.places.slice(0, 5);

  const label = normalizeDestinationLabel(destination);
  return [
    { name: `${label}經典地標`, reason: "第一次來通常會先排的代表性景點" },
    { name: `${label}在地市集或商圈`, reason: "感受在地生活與小吃" },
    { name: `${label}夜景或特色街區`, reason: "傍晚後氛圍最好" },
    { name: `${label}近郊半日遊`, reason: "若想拉開節奏可留半天" },
    { name: `${label}文化或自然景點`, reason: "依你的興趣再細排" },
  ];
}

export function isGenericTemplatePlaceName(name: string, destination: string): boolean {
  return isGenericPlaceLabel(name, destination);
}

/** 具名真實地點 fallback（source=fallback，非泛用模板） */
export function buildNamedFallbackRecommendations(
  destination: string,
): RoamieRecommendationItem[] {
  const label = normalizeDestinationLabel(destination);
  const guide = resolveGuide(label);
  const places = guide?.places ?? [];
  const realPlaces = places.filter((p) => !isGenericTemplatePlaceName(p.name, label));
  if (!realPlaces.length) return [];

  return realPlaces.slice(0, 5).map((place) =>
    normalizeRecommendationItem({
      name: place.name,
      placeName: place.name,
      type: "景點",
      description: place.reason,
      reason: place.reason,
      reasonSource: "fallback",
      estimatedTime: "1-2 小時",
      address: label,
    }),
  );
}

export function buildMustVisitRecommendations(
  destination: string,
): RoamieRecommendationItem[] {
  const label = normalizeDestinationLabel(destination);
  return getMustVisitPlacesForDestination(label).map((place) =>
    normalizeRecommendationItem({
      name: place.name,
      placeName: place.name,
      type: "景點",
      description: place.reason,
      reason: place.reason,
      reasonSource: "template",
      estimatedTime: "1-2 小時",
      address: label,
    }),
  );
}

export function buildMustVisitPlacesReply(ctx: CanonicalTravelContext): string | null {
  const destination = resolveMustVisitDestination(ctx);
  if (!destination) return null;

  const label = normalizeDestinationLabel(destination);
  const places = getMustVisitPlacesForDestination(label);
  const days = ctx.days;
  const guide = resolveGuide(label);
  const profile = classifyDestinationForPlaceSearch(label);
  const city = profile.nearestCity?.trim();
  const header =
    profile.kind === "landmark" && city && city !== label
      ? days
        ? `我幫你找${label}周邊和${city}可順路安排的人氣地點（${days} 天參考）：`
        : `我幫你找${label}周邊和${city}可順路安排的人氣地點：`
      : profile.kind === "landmark"
        ? days
          ? `我幫你找${label}周邊可搭配的人氣地點（${days} 天參考）：`
          : `我幫你找${label}周邊可搭配的人氣地點：`
        : days
          ? `我幫你整理幾個${label}必去點（${days} 天參考）：`
          : `我幫你整理幾個${label}必去點：`;

  const lines = places.map((place, index) => `${index + 1}. ${place.name} — ${place.reason}`);

  const parts = [header, "", ...lines];
  if (guide?.rhythmTip) {
    parts.push("", guide.rhythmTip);
  }
  parts.push("", "想加進行程的話，跟我說你最想先排哪幾個。");

  return parts.join("\n");
}

export type MustVisitAdviceResult = {
  reply: string;
  recommendations: RoamieRecommendationItem[];
  contextPatch: Partial<CanonicalTravelContext>;
};

export function resolveMustVisitAdvice(
  ctx: CanonicalTravelContext,
  userText?: string,
): MustVisitAdviceResult | null {
  try {
  const text = userText?.trim() ?? "";
  if (text && hasCategoryPlaceQuery(text)) return null;
  if (!text && !ctx.mustVisitGenerated) return null;
  if (text && !detectMustVisitIntent(text) && !detectPlaceRecommendationIntent(text)) {
    if (!ctx.mustVisitGenerated) return null;
    if (isAffirmativeReply(text) || /^(嗯|對|對啊)$/i.test(text.trim())) return null;
  }

  const destination = resolveMustVisitDestination(ctx, text);
  if (!destination) return null;

  const mergedCtx = { ...ctx, destination };
  const reply = buildMustVisitPlacesReply(mergedCtx);
  if (!reply) return null;

  const recommendations = buildMustVisitRecommendations(destination);
  const stage = planningStageAfterRecommendations();

  return {
    reply,
    recommendations,
    contextPatch: {
      destination,
      mustVisitGenerated: true,
      tripPurpose: "must_visit_places",
      conversationState: "itinerary_draft",
      planningStage: stage,
    },
  };
  } catch (error) {
    console.warn(
      "[resolveMustVisitAdvice]",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export function mergeContextForPlaceFetch(
  ctx: CanonicalTravelContext = { interests: [] },
  session?: { travelContext?: CanonicalTravelContext | null },
): CanonicalTravelContext {
  return {
    ...ctx,
    ...(session?.travelContext ?? {}),
    interests: session?.travelContext?.interests ?? ctx.interests ?? [],
  };
}

export function shouldFetchDestinationPlaces(
  userText: string,
  ctx: CanonicalTravelContext = { interests: [] },
): boolean {
  if (hasCategoryPlaceQuery(userText)) return false;
  if (!detectMustVisitIntent(userText) && !detectPlaceRecommendationIntent(userText)) {
    return false;
  }
  return Boolean(resolveMustVisitDestination(ctx, userText));
}

export function buildMustVisitContextPatch(
  ctx: CanonicalTravelContext,
  userText?: string,
): Partial<CanonicalTravelContext> {
  const destination = resolveMustVisitDestination(ctx, userText);
  const stage = planningStageAfterMustVisitIntent(Boolean(destination));
  return {
    ...(destination ? { destination } : {}),
    planningStage: stage,
    tripPurpose: "must_visit_places",
  };
}

export function buildDailyRhythmReply(ctx: CanonicalTravelContext): string | null {
  const destination = resolveMustVisitDestination(ctx);
  if (!destination) return null;

  const label = normalizeDestinationLabel(destination);
  const days = ctx.days ?? 5;

  if (label === "曼谷" || label.includes("曼谷")) {
    return [
      `好，${label} ${days} 天我會這樣抓節奏：`,
      "第 1 天：大皇宮、玉佛寺、鄭王廟（市區寺廟）",
      "第 2 天：臥佛寺、ICONSIAM、河畔夜市",
      "第 3 天：恰圖恰市集、按摩、喬德夜市",
      "第 4 天：水上市場或美功鐵道市場半日遊",
      days >= 5 ? "第 5 天：自由安排購物、咖啡廳或近郊" : undefined,
      "",
      "這版節奏偏經典＋市集混搭，不會太趕。",
      "你想把哪一天改成購物或按摩多一點嗎？",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
  }

  return [
    `好，${label} ${days} 天我會建議前段排經典地標，中間穿插美食或市集，最後留 1 天彈性或近郊。`,
    "你想把節奏排得鬆一點，還是多留一天給購物或夜景？",
  ].join("\n");
}
