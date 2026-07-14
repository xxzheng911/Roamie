/**
 * Destination-agnostic travel profile + dynamic combination builder.
 * Flow logic never branches on city names; this module is pure destination DATA + synthesis.
 * Never invents destination+category placeholder place names.
 */
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { getMustVisitPlacesForDestination } from "@/lib/ai/must-visit-places";
import { getLocalLifeCityFallbackNames } from "@/lib/ai/ai-local-life-rules";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { isGenericDestinationPlaceholder } from "@/lib/ai/generic-place-label";
import {
  getCachedDiscoveredCombinations,
  structuredCombinationsToTitlesPlaces,
  validateCombinationOptions,
  type StructuredCombinationOption,
} from "@/lib/ai/destination-combination-discovery";

export type DestinationTravelTheme = {
  /** Combination title shown to user */
  title: string;
  /** Named places / districts for this theme */
  places: string[];
};

export type DestinationTravelProfile = {
  destination: string;
  categories: string[];
  districts: string[];
  themes: DestinationTravelTheme[];
  source: "curated" | "synthesized" | "discovered";
};

/** Curated profiles — data only, not flow control. */
const CURATED_PROFILES: Record<
  string,
  Omit<DestinationTravelProfile, "destination" | "source">
> = {
  台中: {
    categories: ["文創聚落", "商圈夜市", "地標拍照", "近郊自然"],
    districts: ["草悟道", "審計新村", "逢甲", "一中", "東海", "高美"],
    themes: [
      { title: "文創慢逛組合", places: ["審計新村", "草悟道", "勤美誠品綠園道", "宮原眼科"] },
      { title: "商圈夜市組合", places: ["逢甲夜市", "一中商圈", "第二市場"] },
      { title: "經典地標組合", places: ["宮原眼科", "彩虹眷村", "台中公園"] },
      { title: "近郊自然組合", places: ["高美濕地", "東海藝術街", "梧棲漁港"] },
    ],
  },
  臺中: {
    categories: ["文創聚落", "商圈夜市", "地標拍照", "近郊自然"],
    districts: ["草悟道", "審計新村", "逢甲", "一中", "東海", "高美"],
    themes: [
      { title: "文創慢逛組合", places: ["審計新村", "草悟道", "勤美誠品綠園道", "宮原眼科"] },
      { title: "商圈夜市組合", places: ["逢甲夜市", "一中商圈", "第二市場"] },
      { title: "經典地標組合", places: ["宮原眼科", "彩虹眷村", "台中公園"] },
      { title: "近郊自然組合", places: ["高美濕地", "東海藝術街", "梧棲漁港"] },
    ],
  },
  台南: {
    categories: ["古蹟文化", "巷弄美食", "港區", "文創"],
    districts: ["中西區", "安平", "神農街", "國華街", "奇美"],
    themes: [
      { title: "古蹟文化組合", places: ["赤崁樓", "孔廟", "林百貨", "祀典武廟"] },
      { title: "巷弄美食組合", places: ["國華街", "神農街", "花園夜市"] },
      { title: "安平港區組合", places: ["安平老街", "安平古堡", "億載金城"] },
      { title: "文創近郊組合", places: ["藍晒圖", "河樂廣場", "奇美博物館", "十鼓文創園區"] },
    ],
  },
  臺南: {
    categories: ["古蹟文化", "巷弄美食", "港區", "文創"],
    districts: ["中西區", "安平", "神農街", "國華街", "奇美"],
    themes: [
      { title: "古蹟文化組合", places: ["赤崁樓", "孔廟", "林百貨", "祀典武廟"] },
      { title: "巷弄美食組合", places: ["國華街", "神農街", "花園夜市"] },
      { title: "安平港區組合", places: ["安平老街", "安平古堡", "億載金城"] },
      { title: "文創近郊組合", places: ["藍晒圖", "河樂廣場", "奇美博物館", "十鼓文創園區"] },
    ],
  },
  高雄: {
    categories: ["港灣藝術", "夜市美食", "海景", "文創"],
    districts: ["鹽埕", "駁二", "旗津", "愛河", "美麗島"],
    themes: [
      { title: "港灣藝術組合", places: ["駁二藝術特區", "大港橋", "哈瑪星"] },
      { title: "愛河散步組合", places: ["愛河", "美麗島", "鹽埕埔"] },
      { title: "海景跳島組合", places: ["旗津", "西子灣", "鼓山渡輪站"] },
      { title: "夜市美食組合", places: ["瑞豐夜市", "六合夜市", "衛武營"] },
    ],
  },
  台北: {
    categories: ["經典地標", "文創市集", "夜市商圈", "自然近郊"],
    districts: ["信義", "西門", "大稻埕", "松山", "北投"],
    themes: [
      { title: "經典地標組合", places: ["台北101", "中正紀念堂", "龍山寺", "象山"] },
      { title: "文創市集組合", places: ["松山文創園區", "華山1914", "迪化街"] },
      { title: "夜市商圈組合", places: ["饒河夜市", "寧夏夜市", "西門町", "信義商圈"] },
      { title: "近郊放鬆組合", places: ["北投溫泉", "陽明山", "淡水老街"] },
    ],
  },
  臺北: {
    categories: ["經典地標", "文創市集", "夜市商圈", "自然近郊"],
    districts: ["信義", "西門", "大稻埕", "松山", "北投"],
    themes: [
      { title: "經典地標組合", places: ["台北101", "中正紀念堂", "龍山寺", "象山"] },
      { title: "文創市集組合", places: ["松山文創園區", "華山1914", "迪化街"] },
      { title: "夜市商圈組合", places: ["饒河夜市", "寧夏夜市", "西門町", "信義商圈"] },
      { title: "近郊放鬆組合", places: ["北投溫泉", "陽明山", "淡水老街"] },
    ],
  },
  桃園: {
    categories: ["城市文化", "老街美食", "親子休閒", "山區自然"],
    districts: ["大溪", "中壢", "龍潭", "復興", "大園"],
    themes: [
      { title: "城市文化組合", places: ["桃園忠烈祠暨神社文化園區", "虎頭山公園", "桃園美術館"] },
      { title: "老街美食組合", places: ["大溪老街", "中壢夜市", "大溪老茶廠"] },
      { title: "親子休閒組合", places: ["小人國主題樂園", "埔心牧場", "Xpark"] },
      { title: "山區自然組合", places: ["石門水庫", "小烏來", "慈湖"] },
    ],
  },
  台東: {
    categories: ["海岸", "縱谷", "市區", "離島"],
    districts: ["市區", "海岸公路", "池上鹿野", "綠島蘭嶼"],
    themes: [
      { title: "海岸公路組合", places: ["多良車站", "小野柳", "加路蘭", "三仙台"] },
      { title: "市區文化組合", places: ["鐵花村", "台東森林公園", "卑南遺址", "台東觀光夜市"] },
      { title: "縱谷慢旅組合", places: ["池上", "伯朗大道", "鹿野高台", "初鹿牧場"] },
      { title: "離島備案", places: ["綠島", "蘭嶼"] },
    ],
  },
  臺東: {
    categories: ["海岸", "縱谷", "市區", "離島"],
    districts: ["市區", "海岸公路", "池上鹿野", "綠島蘭嶼"],
    themes: [
      { title: "海岸公路組合", places: ["多良車站", "小野柳", "加路蘭", "三仙台"] },
      { title: "市區文化組合", places: ["鐵花村", "台東森林公園", "卑南遺址", "台東觀光夜市"] },
      { title: "縱谷慢旅組合", places: ["池上", "伯朗大道", "鹿野高台", "初鹿牧場"] },
      { title: "離島備案", places: ["綠島", "蘭嶼"] },
    ],
  },
  東京: {
    categories: ["下町經典", "時尚商圈", "文化歷史", "夜景", "近郊"],
    districts: ["淺草", "上野", "新宿", "澀谷", "原宿", "六本木"],
    themes: [
      { title: "經典東京組合", places: ["淺草寺", "東京晴空塔", "上野公園", "阿美橫町"] },
      { title: "時尚商圈組合", places: ["澀谷十字路口", "原宿", "表參道", "新宿"] },
      { title: "文化歷史組合", places: ["明治神宮", "皇居外苑", "日本橋", "銀座"] },
      { title: "夜景地標組合", places: ["東京塔", "六本木", "台場", "豐洲市場"] },
      { title: "近郊備案", places: ["鎌倉", "箱根", "橫濱"] },
    ],
  },
  大阪: {
    categories: ["經典地標", "美食", "親子娛樂", "近郊"],
    districts: ["道頓堀", "心齋橋", "新世界", "大阪城"],
    themes: [
      { title: "經典大阪組合", places: ["大阪城", "道頓堀", "心齋橋", "黑門市場"] },
      { title: "美食探索組合", places: ["新世界", "通天閣", "難波", "美國村"] },
      { title: "親子娛樂組合", places: ["環球影城", "海遊館", "天保山"] },
      { title: "近郊備案", places: ["奈良", "京都", "神戶"] },
    ],
  },
  京都: {
    categories: ["神社寺院", "竹林禪意", "金銀閣", "近郊"],
    districts: ["東山", "嵐山", "祇園", "金閣寺"],
    themes: [
      { title: "經典京都組合", places: ["清水寺", "伏見稻荷大社", "祇園", "八坂神社"] },
      { title: "竹林禪意組合", places: ["嵐山", "竹林小徑", "天龍寺", "渡月橋"] },
      { title: "金閣銀閣組合", places: ["金閣寺", "銀閣寺", "哲學之道", "南禪寺"] },
      { title: "近郊備案", places: ["宇治", "奈良", "大阪"] },
    ],
  },
  首爾: {
    categories: ["古典王宮", "年輕商圈", "購物美食", "夜景"],
    districts: ["景福宮", "弘大", "明洞", "東大門", "南山"],
    themes: [
      { title: "經典首爾組合", places: ["景福宮", "北村韓屋村", "仁寺洞", "光化門"] },
      { title: "年輕商圈組合", places: ["弘大", "梨大", "聖水洞", "延南洞"] },
      { title: "購物美食組合", places: ["明洞", "東大門", "廣藏市場", "樂天世界塔"] },
      { title: "夜景放鬆組合", places: ["南山首爾塔", "漢江", "汝矣島"] },
      { title: "近郊備案", places: ["水原華城", "南怡島", "坡州"] },
    ],
  },
  濟州: {
    categories: ["自然海岸", "火山景觀", "咖啡散步", "購物美食"],
    districts: ["濟州市", "西歸浦", "城山", "漢拿山"],
    themes: [
      { title: "自然風景組合", places: ["城山日出峰", "漢拿山", "牛島", "天地淵瀑布"] },
      { title: "海岸散步組合", places: ["涯月海邊", "挾才海水浴場", "涉地可支", "月汀里海灘"] },
      { title: "人氣美食組合", places: ["黑豬肉一條街", "東門市場", "西歸浦每日偶來市場", "五日市市場"] },
      { title: "購物散策組合", places: ["蓮洞商圈", "濟州中央地下街", "保建洞商圈", "濟州東門市場"] },
    ],
  },
  曼谷: {
    categories: ["寺廟皇宮", "市集購物", "夜生活", "近郊"],
    districts: ["大皇宮", "暹羅", "考山路", "湄南河"],
    themes: [
      { title: "經典曼谷組合", places: ["大皇宮", "玉佛寺", "鄭王廟", "臥佛寺"] },
      { title: "市集購物組合", places: ["恰圖恰市集", "ICONSIAM", "暹羅商圈", "CentralWorld"] },
      { title: "夜生活組合", places: ["喬德夜市", "考山路", "Asiatique", "湄南河"] },
      { title: "近郊備案", places: ["水上市場", "美功鐵道市場", "大城"] },
    ],
  },
  巴黎: {
    categories: ["經典地標", "博物館藝術", "左岸漫步", "近郊"],
    districts: ["塞納河", "馬黑", "蒙馬特", "拉丁區"],
    themes: [
      { title: "經典地標組合", places: ["艾菲爾鐵塔", "凱旋門", "聖母院", "香榭麗舍大道"] },
      { title: "博物館藝術組合", places: ["羅浮宮", "奧塞美術館", "龐畢度中心"] },
      { title: "左岸漫步組合", places: ["聖日耳曼", "拉丁區", "盧森堡公園"] },
      { title: "近郊備案", places: ["凡爾賽宮", "迪士尼樂園"] },
    ],
  },
  紐約: {
    categories: ["經典地標", "博物館", "街區漫遊", "夜景"],
    districts: ["曼哈頓", "布魯克林", "時代廣場", "中央公園"],
    themes: [
      { title: "經典地標組合", places: ["自由女神", "帝國大廈", "時代廣場", "中央公園"] },
      { title: "博物館藝術組合", places: ["大都會博物館", "現代藝術博物館", "古根漢美術館"] },
      { title: "街區漫遊組合", places: ["蘇活", "格林威治村", "布魯克林大橋"] },
      { title: "夜景高處組合", places: ["頂樓觀景台", "布魯克林大橋夜景", "洛克斐勒中心"] },
    ],
  },
};

const THEME_TITLE_POOL = [
  "舊城文化組合",
  "城市慢遊組合",
  "商圈市集組合",
  "藝文博物館組合",
  "近郊自然組合",
];

function cleanPlaceName(name: string): string {
  return name
    .replace(/＋/g, "、")
    .split(/[、/／]/)[0]
    ?.trim() ?? name.trim();
}

function isUsablePlaceName(name: string, destination: string): boolean {
  const n = name.trim();
  if (!n || n.length < 2) return false;
  if (isForbiddenTransitAttraction({ name: n })) return false;
  if (isGenericDestinationPlaceholder(n, destination)) return false;
  return true;
}

function chunkPlaces(places: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < places.length; i += size) {
    const slice = places.slice(i, i + size);
    if (slice.length) out.push(slice);
  }
  return out;
}

function themesToStructured(
  destination: string,
  themes: DestinationTravelTheme[],
): StructuredCombinationOption[] {
  return themes.map((theme, index) => ({
    combinationId: `${destination}:local:${index + 1}`,
    title: theme.title,
    theme: theme.title.replace(/組合$/, ""),
    placeCandidates: theme.places.map((name) => ({
      name,
      searchCandidateId: `name:${name}`,
      types: [],
    })),
  }));
}

/**
 * Synthesize a profile from must-visit + local-life named places when no curated data exists.
 * Still destination-agnostic: same algorithm for every unknown city.
 * NEVER pads with destination+category placeholders.
 */
function synthesizeProfile(destination: string): DestinationTravelProfile {
  const label = normalizeDestinationLabel(destination);
  const fromMustVisit = getMustVisitPlacesForDestination(label)
    .map((p) => cleanPlaceName(p.name))
    .filter((n) => isUsablePlaceName(n, label));
  const fromLocalLife = getLocalLifeCityFallbackNames(label).filter((n) =>
    isUsablePlaceName(n, label),
  );

  const seen = new Set<string>();
  const pool: string[] = [];
  for (const name of [...fromLocalLife, ...fromMustVisit]) {
    if (seen.has(name)) continue;
    seen.add(name);
    pool.push(name);
  }

  // Prefer previously discovered Places-backed combinations when available.
  const discovered = getCachedDiscoveredCombinations(label);
  if (discovered?.length) {
    const themes = structuredCombinationsToTitlesPlaces(discovered);
    logAiPipeline(
      "[DESTINATION_TRAVEL_PROFILE]",
      `destination=${label}`,
      "source=discovered_cache",
      `themes=${themes.length}`,
    );
    return {
      destination: label,
      categories: themes.map((t) => t.title.replace(/組合$/, "")),
      districts: themes.flatMap((t) => t.places).slice(0, 8),
      themes,
      source: "discovered",
    };
  }

  if (pool.length < 6) {
    // Insufficient real named places — return empty; caller must discover via Places
    // or show insufficiency message. Never invent category placeholders.
    logAiPipeline(
      "[DESTINATION_TRAVEL_PROFILE]",
      `destination=${label}`,
      "source=synthesized_empty",
      `pool=${pool.length}`,
    );
    return {
      destination: label,
      categories: [],
      districts: [],
      themes: [],
      source: "synthesized",
    };
  }

  const chunks = chunkPlaces(pool, 3);
  const themes: DestinationTravelTheme[] = chunks.slice(0, 5).map((places, index) => ({
    title: THEME_TITLE_POOL[index] ?? `推薦組合 ${index + 1}`,
    places,
  }));

  return {
    destination: label,
    categories: themes.map((t) => t.title.replace(/組合$/, "")),
    districts: pool.slice(0, 6),
    themes,
    source: "synthesized",
  };
}

/** Memoize profile by normalized destination (+ optional generationRequestId). */
const profileMemo = new Map<string, DestinationTravelProfile>();
let activeProfileGenerationId: string | null = null;

export function beginDestinationTravelProfileSession(generationRequestId?: string): void {
  activeProfileGenerationId = generationRequestId?.trim() || null;
}

export function clearDestinationTravelProfileMemo(destination?: string): void {
  if (!destination) {
    profileMemo.clear();
    return;
  }
  const label = normalizeDestinationLabel(destination);
  for (const key of [...profileMemo.keys()]) {
    if (key === label || key.endsWith(`|${label}`)) profileMemo.delete(key);
  }
}

function profileMemoKey(label: string): string {
  return activeProfileGenerationId ? `${activeProfileGenerationId}|${label}` : label;
}

export function resolveDestinationTravelProfile(destination: string): DestinationTravelProfile {
  const label = normalizeDestinationLabel(destination.trim());
  const memoKey = profileMemoKey(label);

  // Prefer live discovery cache over any previously memoized empty/synthesized profile.
  const discovered = getCachedDiscoveredCombinations(label);
  if (discovered?.length) {
    const cached = profileMemo.get(memoKey);
    if (cached?.source === "discovered") return cached;
    const themes = structuredCombinationsToTitlesPlaces(discovered);
    logAiPipeline("[DESTINATION_TRAVEL_PROFILE]", `destination=${label}`, "source=discovered");
    const profile: DestinationTravelProfile = {
      destination: label,
      categories: themes.map((t) => t.title.replace(/組合$/, "")),
      districts: themes.flatMap((t) => t.places).slice(0, 8),
      themes,
      source: "discovered",
    };
    profileMemo.set(memoKey, profile);
    return profile;
  }

  const cached = profileMemo.get(memoKey);
  if (cached) return cached;

  const curated = CURATED_PROFILES[label];
  if (curated) {
    logAiPipeline("[DESTINATION_TRAVEL_PROFILE]", `destination=${label}`, "source=curated");
    const profile: DestinationTravelProfile = {
      destination: label,
      ...curated,
      source: "curated",
    };
    profileMemo.set(memoKey, profile);
    return profile;
  }
  // Soft alias: substring match for "台中市" etc.
  for (const [key, profileData] of Object.entries(CURATED_PROFILES)) {
    if (label.includes(key) || key.includes(label)) {
      logAiPipeline("[DESTINATION_TRAVEL_PROFILE]", `destination=${label}`, `source=curated:${key}`);
      const profile: DestinationTravelProfile = {
        destination: label,
        ...profileData,
        source: "curated",
      };
      profileMemo.set(memoKey, profile);
      return profile;
    }
  }
  const synthesized = synthesizeProfile(label);
  logAiPipeline(
    "[DESTINATION_TRAVEL_PROFILE]",
    `destination=${label}`,
    `source=${synthesized.source}`,
    `themes=${synthesized.themes.length}`,
  );
  profileMemo.set(memoKey, synthesized);
  return synthesized;
}

/** Dynamic combinations for ANY destination — may be empty until Places discovery completes. */
export function buildDynamicDestinationCombinations(
  destination: string,
): DestinationTravelTheme[] {
  const profile = resolveDestinationTravelProfile(destination);
  const themes = profile.themes
    .map((theme) => ({
      title: theme.title,
      places: theme.places.filter((p) => isUsablePlaceName(p, profile.destination)),
    }))
    .filter((theme) => theme.places.length >= 2);

  const structured = themesToStructured(profile.destination, themes);
  const validation = validateCombinationOptions(structured, profile.destination);
  if (!validation.ok) {
    // Soft: allow curated/discovered profiles with >=3 themes even when
    // validateCombinationOptions is strict about count — re-check manually.
    if (themes.length >= 3 && validation.reason?.startsWith("too_few_combinations")) {
      return themes;
    }
    if (
      themes.length >= 3 &&
      !validation.genericPlaceNames.length &&
      !validation.reason?.startsWith("generic")
    ) {
      // Overlap or unresolved may still be acceptable for curated data caches.
      if (profile.source === "curated" || profile.source === "discovered") {
        return themes;
      }
    }
    if (validation.genericPlaceNames.length || validation.reason?.includes("generic")) {
      return [];
    }
    if (themes.length < 3) return [];
  }

  return themes;
}

export function hasDynamicDestinationCombinations(destination: string): boolean {
  return Boolean(normalizeDestinationLabel(destination).trim());
}
