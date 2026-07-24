import {
  normalizeDestinationLabel,
  isKnownTouristCityLabel,
  isKnownScenicLabel,
  isKnownCountryLabel,
} from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export type DestinationEntityType =
  | "country"
  | "city"
  /** City-state / SAR where city and country share one travel label (SG, HK, MO, …). */
  | "city_state"
  | "province"
  | "state"
  | "region"
  | "island"
  | "archipelago"
  | "resort_area"
  | "district"
  | "administrative_area"
  | "attraction";

export type Hemisphere = "north" | "south" | "equatorial";

export type ClimateZone =
  | "tropical"
  | "subtropical"
  | "temperate_oceanic"
  | "temperate_continental"
  | "mediterranean"
  | "alpine"
  | "desert"
  | "subpolar"
  | "monsoon"
  /** Uncertain profile — never invent temperate_continental when country/coords missing. */
  | "seasonal_general";

export type SeasonEvent = {
  label: string;
  months?: number[];
};

export type DestinationSeasonality = {
  bestMonthRanges: string[];
  events: SeasonEvent[];
  notes: string[];
};

export type DestinationEntity = {
  type: DestinationEntityType;
  name: string;
  country?: string;
  hemisphere: Hemisphere;
  climateZone: ClimateZone;
  seasonality: DestinationSeasonality;
};

type EntitySeed = Omit<DestinationEntity, "name"> & { names: string[] };

const ENTITY_SEEDS: EntitySeed[] = [
  {
    names: ["澳洲", "澳大利亚"],
    type: "country",
    country: "澳洲",
    hemisphere: "south",
    climateZone: "temperate_oceanic",
    seasonality: {
      bestMonthRanges: ["9~11月（春季）", "3~5月（秋季）"],
      events: [
        { label: "賞花季", months: [9, 10, 11] },
        { label: "鯨魚季", months: [6, 7, 8, 9, 10, 11] },
        { label: "雪季（阿爾卑斯山區）", months: [6, 7, 8, 9] },
      ],
      notes: [
        "南半球季節與北半球相反，春秋季通常最舒服。",
        "北部偏熱帶、南部與塔斯馬尼亞偏溫帶，可依區域微調月份。",
      ],
    },
  },
  {
    names: ["塔斯馬尼亞", "Tasmania"],
    type: "island",
    country: "澳洲",
    hemisphere: "south",
    climateZone: "temperate_oceanic",
    seasonality: {
      bestMonthRanges: ["11~3月", "4~5月"],
      events: [{ label: "薰衣草／花季", months: [12, 1, 2] }],
      notes: ["南半球溫帶海洋氣候，夏季（12~2月）適合戶外，但早晚偏涼。"],
    },
  },
  {
    names: ["冰島", "Iceland"],
    type: "country",
    country: "冰島",
    hemisphere: "north",
    climateZone: "subpolar",
    seasonality: {
      bestMonthRanges: ["6~8月", "9~3月（極光季）"],
      events: [
        { label: "極光季", months: [9, 10, 11, 12, 1, 2, 3] },
        { label: "午夜太陽", months: [6, 7] },
      ],
      notes: ["夏季適合環島自駕；冬季適合極光，但天候變化大。"],
    },
  },
  {
    names: ["瑞士"],
    type: "country",
    country: "瑞士",
    hemisphere: "north",
    climateZone: "alpine",
    seasonality: {
      bestMonthRanges: ["6~9月", "12~3月"],
      events: [
        { label: "滑雪季", months: [12, 1, 2, 3] },
        { label: "高山健行", months: [6, 7, 8, 9] },
        { label: "花季", months: [5, 6, 7] },
      ],
      notes: ["夏季適合健行與湖區；冬季適合滑雪與雪景小鎮。"],
    },
  },
  {
    names: ["土耳其"],
    type: "country",
    country: "土耳其",
    hemisphere: "north",
    climateZone: "mediterranean",
    seasonality: {
      bestMonthRanges: ["4~6月", "9~10月"],
      events: [
        { label: "熱氣球（卡帕多奇亞）", months: [4, 5, 9, 10] },
        { label: "鬱金香季（伊斯坦堡）", months: [4, 5] },
      ],
      notes: ["春秋季氣候最穩；夏季沿海很熱、內陸乾燥。"],
    },
  },
  {
    names: ["北海道"],
    type: "region",
    country: "日本",
    hemisphere: "north",
    climateZone: "temperate_continental",
    seasonality: {
      bestMonthRanges: ["6~8月", "12~2月"],
      events: [
        { label: "薰衣草（富良野）", months: [7, 8] },
        { label: "紅葉", months: [10, 11] },
        { label: "雪祭（札幌）", months: [2] },
      ],
      notes: ["夏季涼爽適合自然風光；冬季雪景與滑雪很熱門。"],
    },
  },
  {
    names: ["濟州", "濟州島", "济州", "济州岛"],
    type: "island",
    country: "韓國",
    hemisphere: "north",
    climateZone: "subtropical",
    seasonality: {
      bestMonthRanges: ["4~6月", "9~11月"],
      events: [
        { label: "油菜花季", months: [3, 4] },
        { label: "楓葉與晚秋", months: [10, 11] },
      ],
      notes: ["適合自然風光、海邊散步與自駕；春秋體感最舒服。"],
    },
  },
  {
    names: ["沖繩", "冲绳"],
    type: "island",
    country: "日本",
    hemisphere: "north",
    climateZone: "subtropical",
    seasonality: {
      bestMonthRanges: ["3~5月", "10~11月"],
      events: [],
      notes: ["海島放鬆與潛水熱門；夏季多雨炎熱。"],
    },
  },
  {
    names: ["九州"],
    type: "region",
    country: "日本",
    hemisphere: "north",
    climateZone: "subtropical",
    seasonality: {
      bestMonthRanges: ["3~5月", "10~11月"],
      events: [{ label: "櫻花季", months: [3, 4] }],
      notes: ["溫泉、自然與城市混搭；春秋最舒服。"],
    },
  },
  {
    names: ["峇里島", "巴厘岛", "Bali"],
    type: "island",
    country: "印尼",
    hemisphere: "equatorial",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["4~10月"],
      events: [],
      notes: ["乾季通常較適合旅行；雨季午後易有雷雨。"],
    },
  },
  {
    names: ["普吉島", "普吉", "Phuket"],
    type: "island",
    country: "泰國",
    hemisphere: "north",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["11~4月"],
      events: [],
      notes: ["海島度假熱門；乾季較適合海邊活動。"],
    },
  },
  {
    names: ["蘇梅島", "蘇梅", "苏梅岛", "Koh Samui", "Ko Samui"],
    type: "island",
    country: "泰國",
    hemisphere: "north",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["12~4月"],
      events: [],
      notes: ["較悠閒的海島節奏；適合放鬆與跳島。"],
    },
  },
  {
    names: ["長灘島", "长滩岛"],
    type: "island",
    country: "菲律賓",
    hemisphere: "equatorial",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["11~5月"],
      events: [],
      notes: ["乾季較適合海邊活動。"],
    },
  },
  {
    names: ["夏威夷", "Hawaii"],
    type: "region",
    country: "美國",
    hemisphere: "north",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["4~6月", "9~11月"],
      events: [],
      notes: ["多島嶼度假區；氣候全年溫暖。"],
    },
  },
  {
    names: ["馬爾地夫", "马尔代夫", "Maldives"],
    type: "country",
    country: "馬爾地夫",
    hemisphere: "equatorial",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["12~4月"],
      events: [],
      notes: ["乾季較適合度假與潛水。"],
    },
  },
  {
    names: ["歐洲"],
    type: "region",
    hemisphere: "north",
    climateZone: "temperate_continental",
    seasonality: {
      bestMonthRanges: ["4~6月", "9~10月"],
      events: [
        { label: "聖誕市集", months: [11, 12] },
        { label: "夏季節慶", months: [6, 7, 8] },
      ],
      notes: ["春秋季適合城市與文化行程；夏季海邊與節慶熱門但人潮較多。"],
    },
  },
  {
    names: ["亞洲"],
    type: "region",
    hemisphere: "north",
    climateZone: "monsoon",
    seasonality: {
      bestMonthRanges: ["11~3月", "4~5月", "9~11月"],
      events: [],
      notes: ["區域差異大，東南亞乾季多為 11~3 月；東北亞春秋最舒服。"],
    },
  },
  {
    names: ["北美"],
    type: "region",
    hemisphere: "north",
    climateZone: "temperate_continental",
    seasonality: {
      bestMonthRanges: ["5~6月", "9~10月"],
      events: [{ label: "楓葉季", months: [10] }],
      notes: ["春秋季適合城市與國家公園；冬季北部偏冷。"],
    },
  },
  {
    names: ["南美"],
    type: "region",
    hemisphere: "south",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["9~11月", "3~5月"],
      events: [],
      notes: ["南半球季節相反，春秋季通常較乾爽。"],
    },
  },
  {
    names: ["非洲"],
    type: "region",
    hemisphere: "north",
    climateZone: "desert",
    seasonality: {
      bestMonthRanges: ["5~10月", "11~3月（北非）"],
      events: [{ label: "野生動物大遷徙（東非）", months: [7, 8, 9] }],
      notes: ["區域差異極大，需依子區域（北非／東非／南非）調整。"],
    },
  },
  {
    names: ["大洋洲"],
    type: "region",
    hemisphere: "south",
    climateZone: "temperate_oceanic",
    seasonality: {
      bestMonthRanges: ["9~11月", "3~5月"],
      events: [],
      notes: ["南半球春秋季通常最適合環島與海島行程。"],
    },
  },
  {
    names: ["日本"],
    type: "country",
    country: "日本",
    hemisphere: "north",
    climateZone: "temperate_oceanic",
    seasonality: {
      bestMonthRanges: ["3~5月", "10~11月"],
      events: [
        { label: "櫻花季", months: [3, 4] },
        { label: "楓葉季", months: [10, 11] },
      ],
      notes: ["春秋最舒服；夏季有祭典但較悶熱；冬季北海道雪景很棒。"],
    },
  },
  {
    names: ["韓國", "韩国"],
    type: "country",
    country: "韓國",
    hemisphere: "north",
    climateZone: "temperate_continental",
    seasonality: {
      bestMonthRanges: ["4~5月", "10~11月"],
      events: [
        { label: "櫻花季", months: [4] },
        { label: "楓葉季", months: [10, 11] },
      ],
      notes: ["春秋最適合城市散策；冬季偏冷乾。"],
    },
  },
  {
    names: ["泰國", "泰国"],
    type: "country",
    country: "泰國",
    hemisphere: "north",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["11~2月"],
      events: [],
      notes: ["乾季較舒服；4~5月與 9~10月可避開人潮但午後易有雷雨。"],
    },
  },
  {
    names: ["台灣", "台湾"],
    type: "country",
    country: "台灣",
    hemisphere: "north",
    climateZone: "subtropical",
    seasonality: {
      bestMonthRanges: ["3~5月", "10~11月"],
      events: [],
      notes: ["春秋最舒服；夏季多雨；冬季北部偏濕冷。"],
    },
  },
  {
    names: ["越南"],
    type: "country",
    country: "越南",
    hemisphere: "north",
    climateZone: "monsoon",
    seasonality: {
      bestMonthRanges: ["11~4月"],
      events: [],
      notes: ["南北氣候差異大，11~4 月整體較乾爽。"],
    },
  },
  {
    names: ["新加坡", "Singapore"],
    type: "city_state",
    country: "新加坡",
    hemisphere: "equatorial",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["2~4月", "9~11月"],
      events: [],
      notes: ["全年溫暖；6~8 月較多雨。"],
    },
  },
  {
    names: ["香港", "Hong Kong"],
    type: "city_state",
    country: "香港",
    hemisphere: "north",
    climateZone: "subtropical",
    seasonality: {
      bestMonthRanges: ["10~12月", "3~4月"],
      events: [],
      notes: ["秋冬較舒適；夏季湿热多雨。"],
    },
  },
  {
    names: ["澳門", "澳门", "Macau", "Macao"],
    type: "city_state",
    country: "澳門",
    hemisphere: "north",
    climateZone: "subtropical",
    seasonality: {
      bestMonthRanges: ["10~12月", "3~4月"],
      events: [],
      notes: ["秋冬較舒適；夏季湿热多雨。"],
    },
  },
  {
    names: ["摩納哥", "摩纳哥", "Monaco"],
    type: "city_state",
    country: "摩納哥",
    hemisphere: "north",
    climateZone: "mediterranean",
    seasonality: {
      bestMonthRanges: ["4~6月", "9~10月"],
      events: [],
      notes: ["地中海氣候，春秋最舒適。"],
    },
  },
  {
    names: ["梵蒂岡", "梵蒂冈", "Vatican", "Vatican City"],
    type: "city_state",
    country: "梵蒂岡",
    hemisphere: "north",
    climateZone: "mediterranean",
    seasonality: {
      bestMonthRanges: ["4~6月", "9~10月"],
      events: [],
      notes: ["義大利半島地中海氣候，春秋最適合步行參觀。"],
    },
  },
  {
    names: ["義大利", "意大利"],
    type: "country",
    country: "義大利",
    hemisphere: "north",
    climateZone: "mediterranean",
    seasonality: {
      bestMonthRanges: ["4~6月", "9~10月"],
      events: [],
      notes: ["春秋季最適合；7~8 月很熱、人潮多。"],
    },
  },
  {
    names: ["法國"],
    type: "country",
    country: "法國",
    hemisphere: "north",
    climateZone: "temperate_oceanic",
    seasonality: {
      bestMonthRanges: ["4~6月", "9~10月"],
      events: [{ label: "薰衣草（普羅旺斯）", months: [6, 7] }],
      notes: ["春秋季適合城市與南法；冬季可滑雪或博物館行程。"],
    },
  },
  {
    names: ["蒙古"],
    type: "country",
    country: "蒙古",
    hemisphere: "north",
    climateZone: "temperate_continental",
    seasonality: {
      bestMonthRanges: ["6~9月"],
      events: [],
      notes: ["夏季草原最適合；冬季極寒但雪景壯觀。"],
    },
  },
  {
    names: ["戈壁", "戈壁沙漠", "Gobi", "Gobi Desert"],
    type: "region",
    country: "蒙古",
    hemisphere: "north",
    climateZone: "desert",
    seasonality: {
      bestMonthRanges: ["5~9月"],
      events: [],
      notes: ["戈壁為沙漠／自然區域，非單一城市；行程以區域據點規劃。"],
    },
  },
  {
    names: ["特勒吉", "Terelj"],
    type: "region",
    country: "蒙古",
    hemisphere: "north",
    climateZone: "temperate_continental",
    seasonality: {
      bestMonthRanges: ["6~9月"],
      events: [],
      notes: ["近郊草原與自然風景，適合短途深度行程。"],
    },
  },
  {
    names: ["烏蘭巴托", "乌兰巴托", "Ulaanbaatar", "Ulan Bator"],
    type: "city",
    country: "蒙古",
    hemisphere: "north",
    climateZone: "temperate_continental",
    seasonality: {
      bestMonthRanges: ["6~9月"],
      events: [],
      notes: ["蒙古主要城市起點與文化體驗。"],
    },
  },
  {
    names: ["富士山"],
    type: "attraction",
    country: "日本",
    hemisphere: "north",
    climateZone: "alpine",
    seasonality: {
      bestMonthRanges: ["7~8月（登山）", "11~2月（遠眺雪景）"],
      events: [],
      notes: ["登山季為夏季；其他季節適合河口湖周邊取景。"],
    },
  },
  {
    names: ["曼谷"],
    type: "city",
    country: "泰國",
    hemisphere: "north",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["11~2月"],
      events: [],
      notes: ["乾季較不悶熱，適合城市與寺廟行程。"],
    },
  },
  {
    names: ["墨爾本", "Melbourne"],
    type: "city",
    country: "澳洲",
    hemisphere: "south",
    climateZone: "temperate_oceanic",
    seasonality: {
      bestMonthRanges: [
        "3～5月（秋季）：天氣舒服，適合城市散步、咖啡廳、近郊大洋路",
        "9～11月（春季）：氣溫宜人，適合戶外與近郊",
      ],
      events: [],
      notes: [
        "12～2月為夏季，適合海邊與戶外，但偶爾較熱。",
        "6～8月偏冷且多雨，建議以室內、博物館、咖啡廳為主。",
      ],
    },
  },
];

let entityByNameCache: Map<string, DestinationEntity> | null = null;
let uniqueEntitiesCache: DestinationEntity[] | null = null;

function getEntityByNameMap(): Map<string, DestinationEntity> {
  if (entityByNameCache) return entityByNameCache;
  entityByNameCache = new Map();
  for (const seed of ENTITY_SEEDS) {
    const { names, ...rest } = seed;
    for (const raw of names) {
      const name = normalizeDestinationLabel(raw);
      entityByNameCache.set(name, { name, ...rest });
    }
  }
  return entityByNameCache;
}

/** Unique registered entities (one per canonical name). */
export function listRegisteredDestinationEntities(): DestinationEntity[] {
  if (uniqueEntitiesCache) return uniqueEntitiesCache;
  const seen = new Set<string>();
  const out: DestinationEntity[] = [];
  for (const seed of ENTITY_SEEDS) {
    const { names, ...rest } = seed;
    const name = normalizeDestinationLabel(names[0] ?? "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, ...rest });
  }
  uniqueEntitiesCache = out;
  return out;
}

/**
 * City / region / island entities registered under a country.
 * Used by country→city discovery — not bound to travel month.
 */
export function listChildDestinationsByCountry(country: string): DestinationEntity[] {
  const label = normalizeDestinationLabel(country);
  return listRegisteredDestinationEntities().filter((entity) => {
    if (
      entity.type === "country" ||
      entity.type === "city_state" ||
      entity.type === "attraction"
    ) {
      return false;
    }
    const entityCountry = entity.country
      ? normalizeDestinationLabel(entity.country)
      : undefined;
    return entityCountry === label && entity.name !== label;
  });
}

/** True when the destination is a city-state / SAR (city label == country label). */
export function isCityStateDestination(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  const label = normalizeDestinationLabel(name);
  return resolveDestinationEntity(label).type === "city_state";
}

/**
 * Prefecture/county-scale travel destinations.
 * Users saying「去屏東／宜蘭／北海道」mean a regional travel scope, not CBD-only.
 * Shared lookup — not a per-destination special case in the planning pipeline.
 */
const TRAVEL_REGION_LABELS = new Set([
  // Taiwan counties / travel regions
  "屏東",
  "屏东",
  "宜蘭",
  "花蓮",
  "台東",
  "臺東",
  "南投",
  "嘉義",
  "苗栗",
  "彰化",
  "雲林",
  "新竹",
  "澎湖",
  "金門",
  "馬祖",
  "連江",
  // Japan regions
  "北海道",
  "九州",
  "四國",
  "本州",
  "沖繩",
  "冲绳",
  // Korea
  "濟州",
  "濟州島",
]);

const PARENT_COUNTRY_HINTS: Record<string, string> = {
  東京: "日本",
  大阪: "日本",
  京都: "日本",
  名古屋: "日本",
  福岡: "日本",
  熊本: "日本",
  廣島: "日本",
  広島: "日本",
  長崎: "日本",
  鹿兒島: "日本",
  鹿児島: "日本",
  仙台: "日本",
  金澤: "日本",
  金沢: "日本",
  神戶: "日本",
  神戸: "日本",
  奈良: "日本",
  函館: "日本",
  小樽: "日本",
  輕井澤: "日本",
  白川鄉: "日本",
  橫濱: "日本",
  横浜: "日本",
  箱根: "日本",
  鎌倉: "日本",
  札幌: "日本",
  沖繩: "日本",
  冲绳: "日本",
  北海道: "日本",
  九州: "日本",
  四國: "日本",
  本州: "日本",
  佛羅倫斯: "義大利",
  羅馬: "義大利",
  米蘭: "義大利",
  威尼斯: "義大利",
  塔斯馬尼亞: "澳洲",
  首爾: "韓國",
  釜山: "韓國",
  濟州: "韓國",
  濟州島: "韓國",
  慶州: "韓國",
  江陵: "韓國",
  清邁: "泰國",
  芭達雅: "泰國",
  普吉島: "泰國",
  普吉: "泰國",
  蘇梅島: "泰國",
  蘇梅: "泰國",
  深圳: "中國",
  深圳市: "中國",
  廣州: "中國",
  广州市: "中國",
  廣州市: "中國",
  上海: "中國",
  北京: "中國",
  杭州: "中國",
  成都: "中國",
  廈門: "中國",
  厦门: "中國",
  峇里島: "印尼",
  巴厘岛: "印尼",
  夏威夷: "美國",
  馬爾地夫: "馬爾地夫",
  雪梨: "澳洲",
  墨爾本: "澳洲",
  巴黎: "法國",
  倫敦: "英國",
  愛丁堡: "英國",
  曼徹斯特: "英國",
  湖區: "英國",
  紐約: "美國",
  馬尼拉: "菲律賓",
  宿霧: "菲律賓",
  長灘島: "菲律賓",
  巴拉望: "菲律賓",
  // Taiwan cities / counties — prevent country=unknown when entity has no seed
  台北: "台灣",
  臺北: "台灣",
  新北: "台灣",
  桃園: "台灣",
  台中: "台灣",
  臺中: "台灣",
  台南: "台灣",
  臺南: "台灣",
  高雄: "台灣",
  基隆: "台灣",
  新竹: "台灣",
  苗栗: "台灣",
  南投: "台灣",
  彰化: "台灣",
  雲林: "台灣",
  嘉義: "台灣",
  屏東: "台灣",
  屏东: "台灣",
  宜蘭: "台灣",
  花蓮: "台灣",
  台東: "台灣",
  臺東: "台灣",
  澎湖: "台灣",
  金門: "台灣",
  馬祖: "台灣",
  連江: "台灣",
  墾丁: "台灣",
  阿里山: "台灣",
  日月潭: "台灣",
};

/** True when label is typically planned as a travel region (縣／道／島 scale). */
export function isTravelRegionLabel(name: string): boolean {
  const label = normalizeDestinationLabel(name);
  if (TRAVEL_REGION_LABELS.has(label)) return true;
  if (/(島|岛)$/.test(label) && !isKnownCountryLabel(label)) return true;
  return false;
}

const SOUTHERN_COUNTRY_NAMES = new Set([
  "澳洲",
  "澳大利亚",
  "紐西蘭",
  "新西兰",
  "阿根廷",
  "智利",
  "南非",
  "巴西",
  "秘魯",
  "秘鲁",
]);

const CONTINENTAL_REGIONS = new Set(["歐洲", "北美", "南美", "非洲", "亞洲", "大洋洲"]);

function inferType(name: string): DestinationEntityType {
  if (CONTINENTAL_REGIONS.has(name)) return "region";
  const registered = getEntityByNameMap().get(name);
  if (registered?.type) return registered.type;
  // Country labels must win over short-name → city heuristics
  // (e.g. 日本 / 法國 / 荷蘭 without a trailing 國 character).
  if (isKnownCountryLabel(name) && !isKnownTouristCityLabel(name)) return "country";
  // Island tokens first.
  if (/(島|岛)$/.test(name) || /^(濟州|冲绳|沖繩|夏威夷)$/.test(name)) return "island";
  // Resort / beach-town areas (not full cities).
  if (/^(芭達雅|帕塔雅|墾丁|聖淘沙)$/.test(name)) return "resort_area";
  // Prefecture / county-scale travel regions (屏東、宜蘭、北海道、…) before city default.
  if (isTravelRegionLabel(name)) return "region";
  if (/^(北海道|九州|四國|本州)$/.test(name)) return "region";
  if (isKnownTouristCityLabel(name)) return "city";
  if (isKnownScenicLabel(name)) return "attraction";
  if (/(山|湖|瀑布|國家公園|国家公园|寺|廟|庙)/.test(name)) return "attraction";
  if (/(島|岛)/.test(name)) return "island";
  if (/(省|道|縣|县)$/.test(name)) return "province";
  if (/(州)$/.test(name)) return "province";
  if (/(國|国)$/.test(name)) return "country";
  if (name.length <= 4 && !/(國|国)/.test(name)) return "city";
  return "country";
}

function inferCountry(name: string, type: DestinationEntityType): string | undefined {
  const registered = getEntityByNameMap().get(name);
  if (registered?.country) return registered.country;
  if (PARENT_COUNTRY_HINTS[name]) return PARENT_COUNTRY_HINTS[name];
  if (type === "country" || type === "city_state") return name;
  return undefined;
}

function inferHemisphere(name: string, country?: string): Hemisphere {
  const registered = getEntityByNameMap().get(name);
  if (registered) return registered.hemisphere;
  if (country && SOUTHERN_COUNTRY_NAMES.has(country)) return "south";
  if (SOUTHERN_COUNTRY_NAMES.has(name)) return "south";
  if (/(紐西蘭|新西兰|澳洲|澳大利亚|南美|大洋洲)/.test(name)) return "south";
  if (/(新加坡|印尼|馬來西亞|马来西亚|泰國|泰国|越南|菲律賓|菲律宾)/.test(name)) {
    return "equatorial";
  }
  return "north";
}

function inferClimateZone(
  name: string,
  type: DestinationEntityType,
  country?: string,
): ClimateZone {
  const registered = getEntityByNameMap().get(name);
  if (registered) return registered.climateZone;

  const blob = name + (country ?? "");
  if (/(冰島|Iceland|格陵蘭)/.test(name)) return "subpolar";
  if (/(瑞士|喜馬拉雅|富士山|阿爾卑斯)/.test(name)) return "alpine";
  if (/(土耳其|希臘|西班牙|義大利|意大利|摩洛哥)/.test(blob)) {
    return "mediterranean";
  }
  if (/(泰國|泰国|新加坡|印尼|菲律賓|菲律宾|馬來西亞|马来西亚|越南|印度)/.test(blob)) {
    return "tropical";
  }
  if (/(日本|韓國|韩国|台灣|台湾|香港|澳門|澳门|中國|中国)/.test(blob)) {
    return "subtropical";
  }
  if (/(英國|英国|愛爾蘭|爱尔兰|紐西蘭|新西兰|澳洲|澳大利亚|塔斯馬尼亞)/.test(blob)) {
    return "temperate_oceanic";
  }
  if (type === "region" && name === "大洋洲") return "temperate_oceanic";
  if (type === "region" && name === "南美") return "tropical";
  // Missing country must not invent temperate_continental (屏東 previously hit this).
  return "seasonal_general";
}

/**
 * Climate from coordinates when available; otherwise name/country heuristics.
 * Southern Taiwan (approx south of Tropic of Cancer) → tropical.
 */
export function resolveClimateZoneForDestination(params: {
  destination: string;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): { climateZone: ClimateZone; source: "coordinates" | "country" | "name" | "default" } {
  const name = normalizeDestinationLabel(params.destination);
  const country = params.country ? normalizeDestinationLabel(params.country) : undefined;
  const lat = params.latitude;
  const lng = params.longitude;
  const registered = getEntityByNameMap().get(name);
  if (registered) {
    return { climateZone: registered.climateZone, source: "name" };
  }

  const inTaiwanBbox =
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 21.5 &&
    lat <= 26.5 &&
    lng >= 119.0 &&
    lng <= 122.5;

  if (
    inTaiwanBbox ||
    country === "台灣" ||
    country === "台湾" ||
    PARENT_COUNTRY_HINTS[name] === "台灣"
  ) {
    if (lat != null && Number.isFinite(lat) && lat < 23.5) {
      return { climateZone: "tropical", source: "coordinates" };
    }
    if (lat != null && Number.isFinite(lat)) {
      return { climateZone: "subtropical", source: "coordinates" };
    }
    return { climateZone: "subtropical", source: country ? "country" : "name" };
  }

  if (lat != null && Number.isFinite(lat)) {
    const absLat = Math.abs(lat);
    if (absLat <= 15) return { climateZone: "tropical", source: "coordinates" };
    if (absLat <= 30) return { climateZone: "subtropical", source: "coordinates" };
    if (absLat <= 50) {
      // Don't invent continental without country — seasonal_general is safer.
      if (!country) return { climateZone: "seasonal_general", source: "coordinates" };
      return { climateZone: "temperate_continental", source: "coordinates" };
    }
    return { climateZone: "subpolar", source: "coordinates" };
  }

  const type = inferType(name);
  const zone = inferClimateZone(name, type, country);
  if (zone === "seasonal_general") {
    return { climateZone: zone, source: "default" };
  }
  return { climateZone: zone, source: country ? "country" : "name" };
}

export function inferSeasonalityFromClimate(
  hemisphere: Hemisphere,
  climateZone: ClimateZone,
  name: string,
): DestinationSeasonality {
  const registered = getEntityByNameMap().get(name);
  if (registered) return registered.seasonality;

  if (hemisphere === "south") {
    if (climateZone === "temperate_oceanic" || climateZone === "subtropical") {
      return {
        bestMonthRanges: ["11~3月", "4~5月", "9~10月"],
        events: [],
        notes: [
          `${name}位於南半球，春秋季（9~11月、3~5月）通常最舒服。`,
          "夏季（12~2月）適合戶外，但部分地區較熱；冬季偏涼。",
        ],
      };
    }
    if (climateZone === "tropical") {
      return {
        bestMonthRanges: ["5~10月", "11~4月"],
        events: [],
        notes: ["南半球熱帶地區，乾季通常較適合旅行，但需留意當地雨季月份。"],
      };
    }
  }

  if (climateZone === "tropical" || climateZone === "monsoon") {
    return {
      bestMonthRanges: ["11~3月", "12~2月"],
      events: [],
      notes: ["熱帶／季風氣候，乾季通常較適合；雨季午後易有雷雨。"],
    };
  }

  if (climateZone === "mediterranean") {
    return {
      bestMonthRanges: ["4~6月", "9~10月"],
      events: [],
      notes: ["地中海型氣候，春秋季最舒服；夏季炎熱乾燥、人潮較多。"],
    };
  }

  if (climateZone === "subpolar" || climateZone === "alpine") {
    return {
      bestMonthRanges: ["6~8月", "12~2月"],
      events: [],
      notes: ["夏季適合戶外與健行；冬季適合雪景、極光或滑雪（視地點而定）。"],
    };
  }

  if (climateZone === "temperate_oceanic") {
    return {
      bestMonthRanges: ["5~6月", "9~10月"],
      events: [],
      notes: ["溫帶海洋性氣候，春秋季通常最穩；冬季偏濕冷。"],
    };
  }

  return {
    bestMonthRanges: ["4~6月", "9~10月"],
    events: [],
    notes: [
      `${name}一般春秋兩季（4~6月、9~10月）較適合旅行。`,
      "實際氣候會因緯度與地形而異，可依你想排的活動再微調。",
    ],
  };
}

export function resolveDestinationEntity(rawName: string): DestinationEntity {
  const name = normalizeDestinationLabel(rawName.trim());
  const registered = getEntityByNameMap().get(name);
  if (registered) {
    logDestinationEntityResolved(registered);
    return registered;
  }

  const type = inferType(name);
  const country = inferCountry(name, type);
  const hemisphere = inferHemisphere(name, country);
  const climateResolved = resolveClimateZoneForDestination({
    destination: name,
    country,
  });
  const climateZone = climateResolved.climateZone;
  const seasonality = inferSeasonalityFromClimate(hemisphere, climateZone, name);

  const entity: DestinationEntity = {
    type,
    name,
    country,
    hemisphere,
    climateZone,
    seasonality,
  };

  logDestinationEntityResolved(entity);
  return entity;
}

const entityLogOnce = new Set<string>();

function logDestinationEntityResolved(entity: DestinationEntity): void {
  const key = `${entity.name}|${entity.type}|${entity.country ?? ""}|${entity.climateZone}`;
  if (entityLogOnce.has(key)) return;
  entityLogOnce.add(key);
  // Bound memory for long sessions
  if (entityLogOnce.size > 200) entityLogOnce.clear();

  logAiPipeline("[DESTINATION_ENTITY_RESOLVED]", `name=${entity.name}`, `type=${entity.type}`);
  logAiPipeline("[AI_DESTINATION_ENTITY]", `name=${entity.name}`, `type=${entity.type}`);
  logAiPipeline("[AI_DESTINATION_TYPE]", entity.type);
  if (entity.country) {
    logAiPipeline("[AI_REGION_RESOLVE]", `region=${entity.name}`, `country=${entity.country}`);
    logAiPipeline("[AI_COUNTRY_RESOLVE]", entity.country);
  } else if (entity.type === "country") {
    logAiPipeline("[AI_COUNTRY_RESOLVE]", entity.name);
  }
  logAiPipeline("[AI_HEMISPHERE]", entity.hemisphere);
  logAiPipeline("[AI_CLIMATE_ZONE]", entity.climateZone);
}

export function logBestTravelMonth(ranges: string[]): void {
  logAiPipeline("[AI_BEST_TRAVEL_MONTH]", ranges.join(" | "));
}

export function logSeasonEvents(events: SeasonEvent[]): void {
  if (!events.length) return;
  logAiPipeline(
    "[AI_SEASON_EVENT]",
    events.map((e) => e.label).join(", "),
  );
}
