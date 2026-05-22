import { distanceMeters } from "@/lib/map-explore";
import type { RoamieLocation } from "@/lib/ai/context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import {
  isLateNightMode,
  isLateNightScenicAccessible,
} from "@/lib/filter-available-places";

/** 深夜推薦地點類別（排序與加權用） */
export type LateNightPlaceCategory =
  | "night_view"
  | "scenic_walk"
  | "waterfront"
  | "park"
  | "riverside"
  | "harbor"
  | "observation"
  | "late_cafe"
  | "bar"
  | "supper"
  | "night_market"
  | "ktv"
  | "open_24h"
  | "other";

export type LateNightSceneSeed = {
  name: string;
  type: string;
  category: LateNightPlaceCategory;
  description: string;
  reason: string;
  estimatedTime: string;
  address: string;
  lat: number;
  lng: number;
  /** 區域關鍵字，用於依城市篩選 */
  regions: string[];
  walkFriendly?: boolean;
  transportHint?: string;
};

const SCENIC_CATEGORIES: LateNightPlaceCategory[] = [
  "night_view",
  "scenic_walk",
  "waterfront",
  "park",
  "riverside",
  "harbor",
  "observation",
];

/** 使用者選擇的深夜／夜晚心情 */
export function isLateNightMood(mood?: string | null): boolean {
  if (!mood?.trim()) return false;
  const m = mood.trim();
  return /深夜散步|夜晚探索|深夜模式|深夜|夜遊|夜景/.test(m);
}

/** 深夜散步等心情，或深夜時段 + 放空／獨自 → 啟用場景推薦流程 */
export function shouldActivateLateNightSceneFlow(
  mood?: string | null,
  at: Date = new Date(),
): boolean {
  if (isLateNightMood(mood)) return true;
  if (!isLateNightMode(at)) return false;
  const m = mood?.trim() ?? "";
  return /想放空|一個人|夜晚/.test(m);
}

export function classifyLateNightCategory(name: string, type?: string): LateNightPlaceCategory {
  const blob = `${name} ${type ?? ""}`.toLowerCase();
  if (/ktv|卡拉ok|karaoke/i.test(blob)) return "ktv";
  if (/酒吧|bar|lounge|夜店|pub|居酒/i.test(blob)) return "bar";
  if (/宵夜|夜市|小吃|滷味|燒烤|牛肉湯|鹹酥雞|late.?night.?food/i.test(blob)) return "supper";
  if (/24小時|24小|二十四小時|便利|超商/i.test(blob)) return "open_24h";
  if (/夜景|觀景|展望|燈塔|夕陽|夕照|高字|85|塔/i.test(blob)) return "night_view";
  if (/河岸|河堤|愛河|碼頭|港|海灣|海邊|海岸|堤|滨|水岸|港區/i.test(blob)) {
    return /碼頭|港/i.test(blob) ? "harbor" : "waterfront";
  }
  if (/步道|散步|河濱|绿道|绿道/i.test(blob)) return "scenic_walk";
  if (/公園|park|綠道|草地/i.test(blob)) return "park";
  if (/咖啡|cafe|coffee/i.test(blob)) return /24|深夜|night/i.test(blob) ? "late_cafe" : "other";
  if (/駁二|文創|倉庫|藝術/i.test(blob)) return "scenic_walk";
  return "other";
}

/** 戶外景觀／河岸：深夜仍適合推薦（不因 Google 打烊而排除） */
export function isLateNightAlwaysAccessible(name: string, type?: string): boolean {
  if (isLateNightScenicAccessible(name, type)) return true;
  const cat = classifyLateNightCategory(name, type);
  return SCENIC_CATEGORIES.includes(cat) || cat === "night_market";
}

/** 深夜 open filter：景觀戶外點視為可去 */
export function filterLateNightOpen<T extends { name: string; type?: string }>(
  items: T[],
  isOpen: (item: T) => boolean,
): T[] {
  return items.filter((item) => isOpen(item) || isLateNightAlwaysAccessible(item.name, item.type));
}

const CATEGORY_RANK: Record<LateNightPlaceCategory, number> = {
  night_view: 0,
  scenic_walk: 1,
  observation: 2,
  waterfront: 3,
  riverside: 4,
  harbor: 5,
  park: 6,
  night_market: 8,
  late_cafe: 12,
  supper: 13,
  bar: 14,
  open_24h: 15,
  ktv: 28,
  other: 20,
};

/** 深夜散步：景觀優先；KTV／過吵類型靠後 */
export function lateNightCategoryRankScore(
  category: LateNightPlaceCategory,
  mood?: string | null,
): number {
  let score = CATEGORY_RANK[category] ?? 20;
  if (isLateNightMood(mood) && (category === "ktv" || category === "bar")) {
    score += 15;
  }
  if (/想放空|散步/.test(mood ?? "") && category === "night_view") {
    score -= 2;
  }
  return score;
}

const SCENE_SEEDS: LateNightSceneSeed[] = [
  {
    name: "愛河河畔",
    type: "夜景・河岸散步",
    category: "riverside",
    description: "燈光倒映河面，適合慢慢走、吹風聊天。",
    reason: "高雄經典夜景動線，夜晚氛圍舒服、步調可以很慢。",
    estimatedTime: "1–2 小時",
    address: "高雄市前金區愛河沿岸",
    lat: 22.6202,
    lng: 120.293,
    regions: ["高雄", "前金", "苓雅", "新興"],
    walkFriendly: true,
    transportHint: "可搭捷運至中央公園／三多商圈，再步行進河堤",
  },
  {
    name: "真愛碼頭",
    type: "夜景・港邊",
    category: "harbor",
    description: "港邊燈光與愛河出海口，適合夜晚散步起點或終點。",
    reason: "視野開闊、氣氛浪漫，很適合深夜慢慢走一段。",
    estimatedTime: "45 分–1 小時",
    address: "高雄市鹽埕區真愛碼頭",
    lat: 22.6185,
    lng: 120.2825,
    regions: ["高雄", "鹽埕", "鼓山"],
    walkFriendly: true,
    transportHint: "可與駁二、愛河串成步行路線",
  },
  {
    name: "駁二藝術特區",
    type: "夜景・文創散步",
    category: "scenic_walk",
    description: "倉庫與街區夜間燈光，適合邊走邊看海港氛圍。",
    reason: "夜晚人比白天少，適合慢慢晃、偶爾進小店或咖啡。",
    estimatedTime: "1–2 小時",
    address: "高雄市鹽埕區大勇路",
    lat: 22.6199,
    lng: 120.2815,
    regions: ["高雄", "鹽埕", "鼓山"],
    walkFriendly: true,
    transportHint: "步行可接真愛碼頭、愛河",
  },
  {
    name: "西子灣夕景",
    type: "夜景・海岸",
    category: "night_view",
    description: "海邊夜色與市區燈光，適合看海吹風。",
    reason: "高雄看海代表點之一，深夜仍適合在岸邊散步。",
    estimatedTime: "1 小時",
    address: "高雄市鼓山區西子灣",
    lat: 22.3522,
    lng: 120.2763,
    regions: ["高雄", "鼓山", "旗津"],
    walkFriendly: true,
    transportHint: "可搭渡輪或公車，深夜建議計程車較方便",
  },
  {
    name: "高雄85大樓觀景",
    type: "觀景・城市夜景",
    category: "observation",
    description: "市區高樓夜景，適合想抬頭看城市燈海。",
    reason: "視角高、夜景集中，適合夜晚拍照或靜靜看一會。",
    estimatedTime: "1 小時",
    address: "高雄市苓雅區自强五路39號",
    lat: 22.6126,
    lng: 120.3015,
    regions: ["高雄", "苓雅", "前鎮"],
    walkFriendly: false,
    transportHint: "建議大眾運輸或計程車；入場請先確認營業時間",
  },
  {
    name: "象山步道夜景",
    type: "夜景・登山步道",
    category: "night_view",
    description: "俯瞰台北盆地夜景，適合稍晚上去吹風。",
    reason: "台北最經典夜景之一，步調可快可慢。",
    estimatedTime: "1–2 小時",
    address: "台北市信義區象山步道",
    lat: 25.0275,
    lng: 121.571,
    regions: ["台北", "信義", "南港"],
    walkFriendly: true,
    transportHint: "捷運象山站步行上山；深夜請注意安全",
  },
  {
    name: "大稻埕碼頭",
    type: "河岸・夜景",
    category: "waterfront",
    description: "淡水河畔夜色，適合沿河散步。",
    reason: "台北河岸代表，夜晚燈光舒服、適合慢慢走。",
    estimatedTime: "1 小時",
    address: "台北市大同區大稻埕碼頭",
    lat: 25.177,
    lng: 121.508,
    regions: ["台北", "大同", "迪化"],
    walkFriendly: true,
    transportHint: "可搭捷運北門站步行",
  },
  {
    name: "河濱公園夜間散步",
    type: "河濱・步道",
    category: "scenic_walk",
    description: "開闊河濱步道，適合深夜放空走走。",
    reason: "空間大、視野開，適合一個人或小群慢慢走。",
    estimatedTime: "1–2 小時",
    address: "台北市河濱公園（依最近入口）",
    lat: 25.05,
    lng: 121.53,
    regions: ["台北", "松山", "內湖", "中山"],
    walkFriendly: true,
    transportHint: "依所在河段選最近入口；深夜注意照明",
  },
  {
    name: "赤峰街深夜咖啡",
    type: "深夜咖啡",
    category: "late_cafe",
    description: "巷弄咖啡與小酒吧，適合走累了坐下來。",
    reason: "氣氛偏靜，適合深夜散步後歇腳。",
    estimatedTime: "1 小時",
    address: "台北市大同區赤峰街",
    lat: 25.055,
    lng: 121.519,
    regions: ["台北", "大同", "中山"],
    walkFriendly: true,
    transportHint: "捷運中山／雙連站步行",
  },
  {
    name: "台中草悟道夜間",
    type: "公園・散步",
    category: "park",
    description: "綠帶連接的散步動線，夜晚較靜。",
    reason: "適合不想太吵、只想慢慢走的夜晚。",
    estimatedTime: "1–2 小時",
    address: "台中市西區草悟道",
    lat: 24.145,
    lng: 120.663,
    regions: ["台中", "西區", "北區"],
    walkFriendly: true,
    transportHint: "可從勤美、公益路一帶步行進入",
  },
  {
    name: "安平海岸夜間",
    type: "海岸・散步",
    category: "waterfront",
    description: "海邊夜色與老街延伸動線。",
    reason: "台南夜晚吹海風很舒服，適合慢步調。",
    estimatedTime: "1–2 小時",
    address: "台南市安平區海岸路",
    lat: 22.992,
    lng: 120.167,
    regions: ["台南", "安平"],
    walkFriendly: true,
    transportHint: "可與安平老街、樹屋串成路線",
  },
];

function resolveRegionHints(city?: string | null, lat?: number, lng?: number): string[] {
  const hints: string[] = [];
  if (city?.trim()) hints.push(city.trim());
  if (lat != null && lng != null) {
    if (lat < 23 && lng > 120) hints.push("高雄", "屏東");
    if (lat >= 24.9 && lat <= 25.2) hints.push("台北", "新北");
    if (lat >= 24 && lat < 24.5 && lng > 120.5) hints.push("台中");
    if (lat >= 22.9 && lat < 23.2) hints.push("台南");
  }
  return hints;
}

function seedMatchesRegion(seed: LateNightSceneSeed, hints: string[]): boolean {
  if (!hints.length) return true;
  return seed.regions.some((r) => hints.some((h) => h.includes(r) || r.includes(h)));
}

function seedToRecommendation(
  seed: LateNightSceneSeed,
  origin: { lat: number; lng: number },
): RoamieRecommendationItem {
  const distM = Math.round(distanceMeters(origin, { lat: seed.lat, lng: seed.lng }));
  const distKm = distM < 1000 ? `約 ${distM} 公尺` : `約 ${(distM / 1000).toFixed(1)} 公里`;
  const walkBit = seed.walkFriendly ? "適合散步" : "建議搭車";
  const transport = seed.transportHint ? `｜${seed.transportHint}` : "";
  return {
    name: seed.name,
    type: seed.type,
    description: seed.description,
    reason: `${seed.reason}（${walkBit}）`,
    estimatedTime: seed.estimatedTime,
    address: seed.address,
    lat: seed.lat,
    lng: seed.lng,
    googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(seed.name + " " + seed.address)}`,
    placeName: seed.name,
    reasonSource: "template",
    openStatusLabel: "適合夜晚散步",
    todayHoursLabel: "戶外／景觀區通常全天可散步",
    distanceLabel: distKm,
  } as RoamieRecommendationItem & { distanceLabel?: string };
}

/**
 * 當 AI 推薦不足時，補上區域深夜場景卡（夜景、河岸、散步動線）。
 */
export function lateNightSceneRecommendations(opts: {
  location: RoamieLocation;
  mood?: string | null;
  maxCount?: number;
  excludeNames?: string[];
}): RoamieRecommendationItem[] {
  const max = opts.maxCount ?? 5;
  const origin = { lat: opts.location.lat, lng: opts.location.lng };
  const hints = resolveRegionHints(opts.location.city, opts.location.lat, opts.location.lng);
  const exclude = new Set((opts.excludeNames ?? []).map((n) => n.trim()));

  const candidates = SCENE_SEEDS.filter((s) => seedMatchesRegion(s, hints))
    .map((seed) => ({
      seed,
      dist: distanceMeters(origin, { lat: seed.lat, lng: seed.lng }),
      score: lateNightCategoryRankScore(seed.category, opts.mood) + Math.min(dist / 8000, 12),
    }))
    .filter((x) => !exclude.has(x.seed.name))
    .sort((a, b) => a.score - b.score || a.dist - b.dist);

  const picked: RoamieRecommendationItem[] = [];
  const usedCats = new Set<LateNightPlaceCategory>();

  for (const { seed } of candidates) {
    if (picked.length >= max) break;
    if (usedCats.has(seed.category) && SCENIC_CATEGORIES.includes(seed.category)) continue;
    usedCats.add(seed.category);
    picked.push(seedToRecommendation(seed, origin));
  }

  if (picked.length < 3) {
    for (const { seed } of candidates) {
      if (picked.length >= max) break;
      if (picked.some((p) => p.name === seed.name)) continue;
      picked.push(seedToRecommendation(seed, origin));
    }
  }

  return picked.slice(0, max);
}

export function buildLateNightMoodSummary(opts: {
  city?: string | null;
  mood?: string | null;
  placeCount: number;
}): string {
  const city = opts.city?.trim() || "附近";
  const moodBit = isLateNightMood(opts.mood)
    ? "記著你想深夜散步的心情，"
    : opts.mood?.trim()
      ? `照著「${opts.mood}」的感覺，`
      : "";
  const lead = `${moodBit}這時間${city}慢慢安靜下來了，不過如果想散散步，我先幫你找幾個適合看夜景、吹風、慢慢走的地方。`;
  if (opts.placeCount > 0) {
    return `${lead}\n\n下面這幾個點都挺適合夜晚走走；你想先從哪一個開始？`;
  }
  return `${lead}\n\n要我幫你多找深夜咖啡或宵夜，也可以跟我說 ☺️`;
}

export function mergeLateNightRecommendations(
  aiRecs: RoamieRecommendationItem[],
  sceneRecs: RoamieRecommendationItem[],
  opts?: { maxTotal?: number; mood?: string | null },
): RoamieRecommendationItem[] {
  const max = opts?.maxTotal ?? 5;
  const seen = new Set<string>();
  const out: RoamieRecommendationItem[] = [];

  const push = (list: RoamieRecommendationItem[]) => {
    for (const r of list) {
      if (out.length >= max) return;
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      out.push(r);
    }
  };

  const scenicFirst = [...aiRecs].sort((a, b) => {
    const ca = classifyLateNightCategory(a.name, a.type);
    const cb = classifyLateNightCategory(b.name, b.type);
    return (
      lateNightCategoryRankScore(ca, opts?.mood) - lateNightCategoryRankScore(cb, opts?.mood)
    );
  });

  push(scenicFirst);
  push(sceneRecs);
  return out;
}
