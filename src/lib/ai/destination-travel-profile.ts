/**
 * Destination-agnostic travel profile + dynamic combination builder.
 * Flow logic never branches on city names; this module is pure destination DATA + synthesis.
 * Never invents destination+category placeholder place names.
 */
import {
  normalizeDestinationLabel,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import { lockDestinationCoordinatesFromGeocode } from "@/lib/ai/resolved-destination-scope";
import type { Locale } from "@/lib/i18n/types";
import type { TripLocation } from "@/lib/location/types";
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
import { applyNearbyRegionPolicyToThemes } from "@/lib/ai/region-adjacency";
import {
  assertDestinationConsistency,
  logDestinationContextInvalid,
  resolvePlanningDestination,
} from "@/lib/ai/resolved-trip-destination";

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

export type DestinationAreaScope = {
  displayLabel: string;
  parentCity: string;
  area: string;
  searchScope: "area";
};

const validatedAreaScopes = new Map<string, DestinationAreaScope>();

function areaScopeKey(input: string): string {
  return normalizeDestinationLabel(input).replace(/[\s,，、/／-]+/g, "");
}

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
    districts: ["淺草", "上野", "新宿", "銀座", "澀谷", "原宿", "六本木"],
    themes: [
      { title: "經典東京組合", places: ["淺草寺", "東京晴空塔", "上野公園", "阿美橫町"] },
      { title: "時尚商圈組合", places: ["澀谷十字路口", "原宿", "表參道", "新宿"] },
      { title: "文化歷史組合", places: ["明治神宮", "皇居外苑", "日本橋", "銀座"] },
      { title: "夜景地標組合", places: ["東京塔", "六本木", "台場", "豐洲市場"] },
      { title: "近郊備案", places: ["橫濱", "川崎", "千葉", "埼玉", "鎌倉"] },
    ],
  },
  大阪: {
    categories: ["經典地標", "美食", "親子娛樂", "近郊"],
    districts: ["道頓堀", "心齋橋", "新世界", "大阪城"],
    themes: [
      { title: "經典大阪組合", places: ["大阪城", "道頓堀", "心齋橋", "黑門市場"] },
      { title: "美食探索組合", places: ["くくる道頓堀店", "一蘭道頓堀店", "かに道楽本店", "だるま新世界本店"] },
      { title: "親子娛樂組合", places: ["環球影城", "海遊館", "天保山"] },
      { title: "近郊備案", places: ["奈良", "京都", "神戶"] },
    ],
  },
  名古屋: {
    categories: ["經典地標", "美食", "購物商圈", "近郊"],
    districts: ["名古屋城", "大須", "榮", "名古屋站"],
    themes: [
      { title: "經典名古屋組合", places: ["名古屋城", "熱田神宮", "名古屋電視塔", "綠洲21"] },
      { title: "美食探索組合", places: ["矢場とん本店", "ひつまぶし名古屋備長", "今池世界の山ちゃん", "みそかつの矢場とん"] },
      { title: "購物商圈組合", places: ["榮商圈", "大須商店街", "星ヶ丘テラス", "名鐵百貨"] },
      // Places filled by Region Adjacency at build time (犬山／常滑／瀨戶…).
      { title: "近郊備案", places: ["犬山", "常滑", "瀨戶", "岐阜"] },
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
      { title: "近郊備案", places: ["仁川", "水原", "城南"] },
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

/** Resolve city + district from the existing curated destination profiles. */
export function resolveDestinationAreaScope(input: string): DestinationAreaScope | null {
  const compact = normalizeDestinationLabel(input).replace(/[\s,，、/／-]+/g, "");
  if (!compact) return null;
  const validated = validatedAreaScopes.get(compact);
  if (validated) return validated;
  const matches: DestinationAreaScope[] = [];
  for (const [parentCity, profile] of Object.entries(CURATED_PROFILES)) {
    if (!compact.includes(parentCity)) continue;
    for (const area of profile.districts) {
      const normalizedArea = normalizeDestinationLabel(area).replace(/\s+/g, "");
      if (!normalizedArea || !compact.includes(normalizedArea)) continue;
      matches.push({
        displayLabel: `${parentCity}${normalizedArea}`,
        parentCity,
        area: normalizedArea,
        searchScope: "area",
      });
    }
  }
  return matches.sort(
    (a, b) => b.parentCity.length + b.area.length - (a.parentCity.length + a.area.length),
  )[0] ?? null;
}

export type DestinationAreaCandidate = {
  displayLabel: string;
  parentCity: string;
  area: string;
};

/**
 * Untrusted geographic phrase extracted from a Place/category query.
 * Not limited to "district": township / sublocality / neighborhood are allowed.
 * Never trusted until provider validation; parentCity is intentionally absent.
 */
export type ProvisionalDestinationAreaCandidate = {
  rawLabel: string;
  areaCandidate: string;
  parentCity: undefined;
  validationStatus: "pending_provider";
};

const AREA_QUERY_STOP =
  /(?:有什麼|有甚麼|有什么|有沒有|有没有|推薦|推荐|咖啡廳|咖啡店|咖啡|餐廳|餐厅|景點|景点|地點|地点|哪裡|哪里|可以|適合|适合|嗎|吗|呢|吧|？|\?|$)/;
const PLACE_CATEGORY_TOKEN =
  /(?:咖啡廳|咖啡店|咖啡館|咖啡馆|咖啡|餐廳|餐馆|餐館|美食|景點|景点|地點|地点|購物|逛街|酒吧|夜市|室內|室内|拉麵店|拉麵|拉面)/g;
const INVALID_AREA_FRAGMENT = /^(?:附近|周邊|周边|市區|市区|當地|当地|這裡|这里|那裡|那里)$/;
const INVALID_DISTRICT_ONLY_FRAGMENT =
  /^(?:想找|找|想看|推薦|推荐|請推薦|请推荐|有推薦|有推荐|哪裡|哪里|什麼|什么|有)$/;
const INVALID_GEOGRAPHIC_FRAGMENT =
  /^(?:附近|周邊|周边|市區|市区|當地|当地|這裡|这里|那裡|那里|完全不是|安靜一點|安静一点|熱鬧一點|热闹一点)$/;
const INVALID_GEOGRAPHIC_SUBSTRING =
  /(?:安靜|安静|熱鬧|热闹|便宜|高級|高级|不限時|不限时|更多|其他|還有|还有|一點|一点|一些|更好|插座|甜點|甜点)/;
const GEOGRAPHIC_WANT_RE =
  /(?:想找|找|想看)([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]{2,12})的/u;

function looksLikeGeographicLabel(label: string): boolean {
  return (
    label.length >= 2 &&
    label.length <= 12 &&
    !INVALID_AREA_FRAGMENT.test(label) &&
    !INVALID_DISTRICT_ONLY_FRAGMENT.test(label) &&
    !INVALID_GEOGRAPHIC_FRAGMENT.test(label) &&
    !INVALID_GEOGRAPHIC_SUBSTRING.test(label) &&
    /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]+$/u.test(label)
  );
}

function extractRawGeographicLabel(input: string): string {
  const normalized = normalizeDestinationLabel(input);
  const fromWant = normalized.match(GEOGRAPHIC_WANT_RE)?.[1]?.trim() ?? "";
  const rawLabel = (fromWant || normalized.split(AREA_QUERY_STOP)[0] || "").trim();
  return rawLabel
    .replace(/^(?:請問|请问|想找|想看|找)/, "")
    .replace(PLACE_CATEGORY_TOKEN, "")
    .replace(/[的之]$/g, "")
    .replace(/(?:有|想找|找|想看)$/g, "")
    .replace(/[\s,，、/／-]+/g, "");
}

/**
 * Extract an untrusted geographic label for provider validation.
 * Does not require KNOWN_CITIES / curated district / city+district format.
 */
export function extractProvisionalDestinationAreaCandidate(
  input: string,
): ProvisionalDestinationAreaCandidate | null {
  if (resolveDestinationAreaScope(input) || resolveDestinationFromText(input)) return null;
  const areaCandidate = extractRawGeographicLabel(input);
  if (!looksLikeGeographicLabel(areaCandidate)) return null;
  return {
    rawLabel: areaCandidate,
    areaCandidate,
    parentCity: undefined,
    validationStatus: "pending_provider",
  };
}

export function hasPendingProviderGeographicCandidate(input: string): boolean {
  return extractProvisionalDestinationAreaCandidate(input) != null;
}

/** Extract only a possible city-tail area. This does not make it trusted. */
export function extractGenericDestinationAreaCandidate(
  input: string,
): DestinationAreaCandidate | null {
  const existing = resolveDestinationAreaScope(input);
  if (existing) return existing;
  const normalized = normalizeDestinationLabel(input);
  const parentCity = resolveDestinationFromText(input);
  if (!parentCity) return null;
  const cityIndex = normalized.indexOf(parentCity);
  if (cityIndex < 0) return null;
  const afterCity = normalized.slice(cityIndex + parentCity.length);
  const rawFragment = afterCity.split(AREA_QUERY_STOP)[0]?.trim() ?? "";
  const area = rawFragment
    .replace(/^[市縣县]/, "")
    .replace(/^(?:的|之)/, "")
    .replace(/[\s,，、/／-]+/g, "")
    .replace(/(?:有|想找|找|想看)$/g, "");
  if (
    area.length < 2 ||
    area.length > 8 ||
    INVALID_AREA_FRAGMENT.test(area) ||
    !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]+$/u.test(area)
  ) {
    return null;
  }
  return {
    displayLabel: `${parentCity}${area}`,
    parentCity,
    area,
  };
}

export function locationValidatesDestinationArea(
  candidate: DestinationAreaCandidate,
  location: TripLocation | null,
): boolean {
  if (!location) return false;
  const blob = areaScopeKey(
    [
      location.city,
      location.region,
      location.district,
      location.sublocality,
      location.formattedName,
      location.displayLabel,
      location.address,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const area = areaScopeKey(candidate.area).replace(/[區区]$/, "");
  const city = areaScopeKey(candidate.parentCity).replace(/[市縣县]$/, "");
  return Boolean(
    location.placeId &&
      area &&
      city &&
      blob.includes(area) &&
      blob.includes(city),
  );
}

function normalizedAdministrativeLabel(value: string | undefined): string {
  return normalizeDestinationLabel(value ?? "")
    .replace(/[\s,，、/／-]+/g, "")
    .replace(/(?:市|縣|县|區|区|鎮|镇|鄉|乡|町)$/u, "");
}

function destinationAreaCandidateFromProvider(
  provisional: ProvisionalDestinationAreaCandidate,
  location: TripLocation | null,
): DestinationAreaCandidate | null {
  if (!location?.placeId) return null;
  const expectedArea = normalizedAdministrativeLabel(provisional.areaCandidate);
  // Locality / township (埔里鎮) may live in city rather than district.
  const providerAreas = [location.district, location.sublocality, location.city]
    .map(normalizedAdministrativeLabel)
    .filter(Boolean);
  if (!expectedArea || !providerAreas.some((area) => area === expectedArea)) return null;

  const parentCity = [location.city, location.region]
    .map(normalizedAdministrativeLabel)
    .find((label) => Boolean(label && label !== expectedArea));
  if (!parentCity) return null;

  return {
    displayLabel: `${parentCity}${expectedArea}`,
    parentCity,
    area: expectedArea,
  };
}

/** Curated scopes are immediate; generic fragments require provider evidence. */
export async function resolveValidatedDestinationAreaScope(params: {
  input: string;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
}): Promise<DestinationAreaScope | null> {
  const curated = resolveDestinationAreaScope(params.input);
  if (curated) return curated;
  const genericCandidate = extractGenericDestinationAreaCandidate(params.input);
  const provisionalCandidate = genericCandidate
    ? null
    : extractProvisionalDestinationAreaCandidate(params.input);
  if (!genericCandidate && !provisionalCandidate) return null;
  const geocodeTarget = genericCandidate?.displayLabel ?? provisionalCandidate!.rawLabel;
  let result: Awaited<ReturnType<GeocodeDestinationFn>>;
  try {
    result = await params.geocodeFn({
      data: {
        query: geocodeTarget,
        destinationName: geocodeTarget,
        locale: params.locale,
        language: params.locale,
        disableLocaleRegionBias: true,
        placesFallback: false,
      },
    });
  } catch {
    return null;
  }
  const location = result.location;
  const candidate = genericCandidate ?? destinationAreaCandidateFromProvider(
    provisionalCandidate!,
    location,
  );
  if (!candidate) return null;
  if (!locationValidatesDestinationArea(candidate, location)) return null;
  const validated: DestinationAreaScope = {
    ...candidate,
    searchScope: "area",
  };
  validatedAreaScopes.set(areaScopeKey(validated.displayLabel), validated);
  lockDestinationCoordinatesFromGeocode({
    destination: validated.displayLabel,
    lat: location!.lat,
    lng: location!.lng,
    country: location!.country,
  });
  return validated;
}

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
    // Insufficient curated names — never invent placeholders.
    // Incomplete destination state must not look like "empty Places pool".
    const resolved = resolvePlanningDestination({ destination: label });
    const consistency = assertDestinationConsistency(resolved);
    if (!consistency.ok) {
      logDestinationContextInvalid(resolved, consistency.missingFields);
      logAiPipeline(
        "[DESTINATION_TRAVEL_PROFILE]",
        `destination=${label}`,
        "source=destination_context_invalid",
        `pool=${pool.length}`,
        `missingFields=[${consistency.missingFields.join(",")}]`,
      );
      return {
        destination: label,
        categories: [],
        districts: [],
        themes: [],
        source: "synthesized",
      };
    }
    // Resolved destination is complete — defer to Places discovery (not synthesized_empty).
    logAiPipeline(
      "[DESTINATION_TRAVEL_PROFILE]",
      `destination=${label}`,
      "source=pending_places_discovery",
      `pool=${pool.length}`,
      `countryCode=${resolved?.countryCode ?? ""}`,
      `lat=${resolved?.latitude ?? ""}`,
      `lng=${resolved?.longitude ?? ""}`,
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
  opts?: { tripDays?: number | null; includeFartherNearby?: boolean },
): DestinationTravelTheme[] {
  const profile = resolveDestinationTravelProfile(destination);
  const rawThemes = profile.themes
    .map((theme) => ({
      title: theme.title,
      places: theme.places.filter((p) => isUsablePlaceName(p, profile.destination)),
    }))
    .filter((theme) => theme.places.length >= 2);

  // Region Adjacency: replace/filter 「近郊備案」 with living-circle regions.
  // When tripDays omitted, keep nearby (compat); reply builder applies day gate.
  const themes = applyNearbyRegionPolicyToThemes(
    profile.destination,
    rawThemes,
    {
      tripDays: opts?.tripDays,
      includeFarther: Boolean(opts?.includeFartherNearby),
      // Without explicit days, do not suppress (callers with days pass tripDays).
      forceInclude: opts?.tripDays == null,
      maxCandidates: opts?.tripDays == null ? 5 : undefined,
    },
  ).filter((theme) => {
    if (theme.places.length >= 2) return true;
    // Medium trips may only surface 1 nearby region option.
    return (
      theme.places.length >= 1 &&
      /近郊/.test(theme.title)
    );
  });

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
