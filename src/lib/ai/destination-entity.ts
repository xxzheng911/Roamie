import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

export type DestinationEntityType =
  | "country"
  | "city"
  | "region"
  | "island"
  | "state"
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
  | "monsoon";

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
    names: ["新加坡"],
    type: "country",
    country: "新加坡",
    hemisphere: "north",
    climateZone: "tropical",
    seasonality: {
      bestMonthRanges: ["2~4月", "9~11月"],
      events: [],
      notes: ["全年溫暖；6~8 月較多雨。"],
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
];

const ENTITY_BY_NAME = new Map<string, DestinationEntity>();

for (const seed of ENTITY_SEEDS) {
  const { names, ...rest } = seed;
  for (const raw of names) {
    const name = normalizeDestinationLabel(raw);
    ENTITY_BY_NAME.set(name, { name, ...rest });
  }
}

const PARENT_COUNTRY_HINTS: Record<string, string> = {
  東京: "日本",
  大阪: "日本",
  京都: "日本",
  札幌: "日本",
  沖繩: "日本",
  首爾: "韓國",
  釜山: "韓國",
  濟州: "韓國",
  清邁: "泰國",
  芭達雅: "泰國",
  普吉島: "泰國",
  雪梨: "澳洲",
  墨爾本: "澳洲",
  巴黎: "法國",
  倫敦: "英國",
  紐約: "美國",
};

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
  if (ENTITY_BY_NAME.get(name)?.type) return ENTITY_BY_NAME.get(name)!.type;
  if (/(山|湖|瀑布|國家公園|国家公园|寺|廟|庙)/.test(name)) return "attraction";
  if (/(島|岛)/.test(name)) return "island";
  if (/(省|州|道|縣|县)/.test(name)) return "state";
  if (name.length <= 4 && !/(國|国)/.test(name)) return "city";
  return "country";
}

function inferCountry(name: string, type: DestinationEntityType): string | undefined {
  const registered = ENTITY_BY_NAME.get(name);
  if (registered?.country) return registered.country;
  if (PARENT_COUNTRY_HINTS[name]) return PARENT_COUNTRY_HINTS[name];
  if (type === "country") return name;
  return undefined;
}

function inferHemisphere(name: string, country?: string): Hemisphere {
  const registered = ENTITY_BY_NAME.get(name);
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
  const registered = ENTITY_BY_NAME.get(name);
  if (registered) return registered.climateZone;

  if (/(冰島|Iceland|格陵蘭)/.test(name)) return "subpolar";
  if (/(瑞士|喜馬拉雅|富士山|阿爾卑斯)/.test(name)) return "alpine";
  if (/(土耳其|希臘|西班牙|義大利|意大利|摩洛哥)/.test(name + (country ?? ""))) {
    return "mediterranean";
  }
  if (/(泰國|泰国|新加坡|印尼|菲律賓|菲律宾|馬來西亞|马来西亚|越南|印度)/.test(name + (country ?? ""))) {
    return "tropical";
  }
  if (/(日本|韓國|韩国|台灣|台湾|香港|澳門|澳门|中國|中国)/.test(name + (country ?? ""))) {
    return "subtropical";
  }
  if (/(英國|英国|愛爾蘭|爱尔兰|紐西蘭|新西兰|澳洲|澳大利亚|塔斯馬尼亞)/.test(name + (country ?? ""))) {
    return "temperate_oceanic";
  }
  if (type === "region" && name === "大洋洲") return "temperate_oceanic";
  if (type === "region" && name === "南美") return "tropical";
  return "temperate_continental";
}

export function inferSeasonalityFromClimate(
  hemisphere: Hemisphere,
  climateZone: ClimateZone,
  name: string,
): DestinationSeasonality {
  const registered = ENTITY_BY_NAME.get(name);
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
  const registered = ENTITY_BY_NAME.get(name);
  if (registered) {
    logDestinationEntityResolved(registered);
    return registered;
  }

  const type = inferType(name);
  const country = inferCountry(name, type);
  const hemisphere = inferHemisphere(name, country);
  const climateZone = inferClimateZone(name, type, country);
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

function logDestinationEntityResolved(entity: DestinationEntity): void {
  console.info("[AI_DESTINATION_ENTITY]", `name=${entity.name}`, `type=${entity.type}`);
  console.info("[AI_DESTINATION_TYPE]", entity.type);
  if (entity.country) {
    console.info("[AI_REGION_RESOLVE]", `region=${entity.name}`, `country=${entity.country}`);
    console.info("[AI_COUNTRY_RESOLVE]", entity.country);
  } else if (entity.type === "country") {
    console.info("[AI_COUNTRY_RESOLVE]", entity.name);
  }
  console.info("[AI_HEMISPHERE]", entity.hemisphere);
  console.info("[AI_CLIMATE_ZONE]", entity.climateZone);
}

export function logBestTravelMonth(ranges: string[]): void {
  console.info("[AI_BEST_TRAVEL_MONTH]", ranges.join(" | "));
}

export function logSeasonEvents(events: SeasonEvent[]): void {
  if (!events.length) return;
  console.info(
    "[AI_SEASON_EVENT]",
    events.map((e) => e.label).join(", "),
  );
}
