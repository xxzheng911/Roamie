/**
 * Universal Recommendation Refinement Parser.
 * Parses cuisine / type / budget / atmosphere / exclusions / meal / more — not page-specific.
 */
import type {
  RecommendationBudget,
  RecommendationBudgetLevel,
  RecommendationIntent,
  RecommendationMealSlot,
  RecommendationRefinementPatch,
} from "@/lib/ai/recommendation-refinement/types";
import { matchesContinueRecommendationGrammar } from "@/lib/ai/continue-recommendation-intent";

type CuisineDef = {
  id: string;
  labels: string[];
  /** Positive match patterns (want this cuisine) */
  patterns: RegExp[];
};

const RESTAURANT_CUISINES: CuisineDef[] = [
  // Japanese
  {
    id: "ramen",
    labels: ["拉麵", "ラーメン", "ramen"],
    patterns: [/拉麵|拉面|ラーメン|ramen/i],
  },
  {
    id: "sushi",
    labels: ["壽司", "寿司", "sushi"],
    patterns: [/壽司|寿司|sushi/i],
  },
  {
    id: "conveyor_sushi",
    labels: ["迴轉壽司", "回転寿司", "conveyor belt sushi"],
    patterns: [/迴轉壽司|回转寿司|回転寿司|conveyor\s*(?:belt\s*)?sushi/i],
  },
  {
    id: "sukiyaki",
    labels: ["壽喜燒", "すき焼き", "sukiyaki", "牛鍋"],
    patterns: [/壽喜燒|寿喜焼|すき焼き|すきやき|sukiyaki|牛鍋/i],
  },
  {
    id: "bbq",
    labels: ["燒肉", "烤肉", "yakiniku"],
    patterns: [/燒肉|烤肉|焼肉|yakiniku|\bbbq\b/i],
  },
  {
    id: "izakaya",
    labels: ["居酒屋", "izakaya"],
    patterns: [/居酒屋|izakaya/i],
  },
  {
    id: "tempura",
    labels: ["天婦羅", "天ぷら", "tempura"],
    patterns: [/天婦羅|天妇罗|天ぷら|tempura/i],
  },
  {
    id: "donburi",
    labels: ["丼飯", "どんぶり", "donburi"],
    patterns: [/丼飯|丼|どんぶり|donburi/i],
  },
  {
    id: "udon",
    labels: ["烏龍麵", "うどん", "udon"],
    patterns: [/烏龍麵|乌龙面|うどん|udon/i],
  },
  {
    id: "soba",
    labels: ["蕎麥麵", "そば", "soba"],
    patterns: [/蕎麥麵|荞麦面|そば|soba/i],
  },
  {
    id: "japanese_curry",
    labels: ["日式咖哩", "カレー", "japanese curry"],
    patterns: [/日式咖哩|日式咖喱|日本咖哩|japanese\s*curry/i],
  },
  {
    id: "curry",
    labels: ["咖哩", "カレー", "curry"],
    patterns: [/咖哩|咖喱|カレー|curry/i],
  },
  {
    id: "unagi",
    labels: ["鰻魚飯", "うなぎ", "unagi"],
    patterns: [/鰻魚飯|鳗鱼饭|鰻魚|うなぎ|unagi/i],
  },
  {
    id: "tonkatsu",
    labels: ["炸豬排", "とんかつ", "tonkatsu"],
    patterns: [/炸豬排|炸猪排|とんかつ|tonkatsu|katsudon/i],
  },
  {
    id: "teppanyaki",
    labels: ["鐵板燒", "鉄板焼き", "teppanyaki"],
    patterns: [/鐵板燒|铁板烧|鉄板焼き|teppanyaki/i],
  },
  {
    id: "kaiseki",
    labels: ["懷石料理", "懐石", "kaiseki"],
    patterns: [/懷石|怀石|懐石|kaiseki/i],
  },
  {
    id: "washoku",
    labels: ["和食", "washoku"],
    patterns: [/和食|washoku/i],
  },
  {
    id: "teishoku",
    labels: ["日式定食", "定食", "teishoku"],
    patterns: [/日式定食|定食|teishoku/i],
  },
  {
    id: "jingisukan",
    labels: ["成吉思汗烤肉", "ジンギスカン", "jingisukan"],
    patterns: [/成吉思汗|ジンギスカン|jingisukan|genghis/i],
  },
  {
    id: "crab",
    labels: ["螃蟹料理", "蟹", "crab"],
    patterns: [/螃蟹料理|螃蟹|毛蟹|鱈場蟹|タラバ|かに|蟹料理|crab/i],
  },
  {
    id: "kaisendon",
    labels: ["海鮮丼", "海鮮丼", "kaisendon"],
    patterns: [/海鮮丼|海鲜丼|かいせんどん|kaisendon/i],
  },
  {
    id: "sashimi",
    labels: ["刺身", "さしみ", "sashimi"],
    patterns: [/刺身|さしみ|sashimi/i],
  },
  {
    id: "yakitori",
    labels: ["串燒", "焼き鳥", "yakitori"],
    patterns: [/串燒|串烧|焼き鳥|yakitori/i],
  },
  {
    id: "nabe",
    labels: ["鍋物", "なべ", "nabe"],
    patterns: [/鍋物|锅物|なべ|\bnabe\b/i],
  },
  {
    id: "japanese",
    labels: ["日式", "日料", "japanese"],
    patterns: [/日式|日料|japanese\s*(?:food|restaurant|cuisine)/i],
  },
  // Western
  {
    id: "pasta",
    labels: ["義大利麵", "パスタ", "pasta"],
    patterns: [/義大利麵|意大利面|パスタ|pasta/i],
  },
  {
    id: "italian",
    labels: ["義式料理", "italian"],
    // Bare 義大利/意大利 is a country destination — require food surface.
    patterns: [/義式料理|义式料理|義式|义式|義大利料理|意大利料理|義大利菜|意大利菜|italian\s*(?:food|cuisine|restaurant)/i],
  },
  {
    id: "pizza",
    labels: ["披薩", "ピザ", "pizza"],
    patterns: [/披薩|披萨|ピザ|pizza/i],
  },
  {
    id: "steak",
    labels: ["牛排", "steak"],
    patterns: [/牛排|steak/i],
  },
  {
    id: "burger",
    labels: ["漢堡", "burger"],
    patterns: [/漢堡|汉堡|hamburger|burger/i],
  },
  {
    id: "french",
    labels: ["法式料理", "french"],
    patterns: [/法式料理|法式|french\s*(?:food|cuisine|restaurant)/i],
  },
  {
    id: "western",
    labels: ["西餐", "western"],
    patterns: [/西餐|western\s*(?:food|cuisine)/i],
  },
  {
    id: "mexican",
    labels: ["墨西哥料理", "mexican"],
    // Bare 墨西哥 is a country destination — require food surface.
    patterns: [/墨西哥料理|墨西哥菜|mexican\s*(?:food|cuisine|restaurant)/i],
  },
  {
    id: "spanish",
    labels: ["西班牙料理", "spanish"],
    // Bare 西班牙 is a country destination — require food surface.
    patterns: [/西班牙料理|西班牙菜|spanish\s*(?:food|cuisine)|tapas/i],
  },
  {
    id: "mediterranean",
    labels: ["地中海料理", "mediterranean"],
    patterns: [/地中海|mediterranean/i],
  },
  {
    id: "brunch",
    labels: ["早午餐", "brunch"],
    patterns: [/早午餐|brunch/i],
  },
  // Chinese / Taiwanese
  {
    id: "chinese",
    labels: ["中式料理", "chinese"],
    patterns: [/中式料理|中式|中餐|chinese\s*(?:food|cuisine|restaurant)/i],
  },
  {
    id: "sichuan",
    labels: ["川菜", "sichuan"],
    patterns: [/川菜|四川菜|sichuan/i],
  },
  {
    id: "cantonese",
    labels: ["粵菜", "cantonese"],
    patterns: [/粵菜|粤菜|cantonese/i],
  },
  {
    id: "dim_sum",
    labels: ["港式飲茶", "dim sum"],
    patterns: [/港式飲茶|港式|飲茶|饮茶|dim\s*sum/i],
  },
  {
    id: "xiaolongbao",
    labels: ["小籠包", "xiaolongbao"],
    patterns: [/小籠包|小笼包|xiaolongbao|soup\s*dumpling/i],
  },
  {
    id: "hotpot",
    labels: ["火鍋", "hotpot"],
    patterns: [/火鍋|火锅|hot\s*pot|shabu|涮涮/i],
  },
  {
    id: "spicy_hotpot",
    labels: ["麻辣鍋", "spicy hotpot"],
    patterns: [/麻辣鍋|麻辣锅|麻辣火鍋|spicy\s*hot\s*pot/i],
  },
  {
    id: "taiwanese",
    labels: ["台灣料理", "taiwanese"],
    patterns: [/台灣料理|台湾料理|台式|台菜|taiwanese/i],
  },
  {
    id: "beijing",
    labels: ["北京菜", "beijing"],
    patterns: [/北京菜|京菜|beijing\s*(?:food|cuisine)/i],
  },
  {
    id: "shanghai",
    labels: ["上海菜", "shanghai"],
    patterns: [/上海菜|滬菜|沪菜|shanghai\s*(?:food|cuisine)/i],
  },
  // Other
  {
    id: "korean",
    labels: ["韓式料理", "korean"],
    patterns: [/韓式料理|韩式料理|韓式|韩式|korean/i],
  },
  {
    id: "thai",
    labels: ["泰式料理", "thai"],
    patterns: [/泰式料理|泰式|thai/i],
  },
  {
    id: "vietnamese",
    labels: ["越南料理", "vietnamese"],
    // Bare 越南 is a country destination (「我 1 月要去越南」) — require food surface.
    patterns: [/越南料理|越南菜|越南餐|越南粉|越南河粉|vietnamese\s*(?:food|cuisine|restaurant)|pho\b/i],
  },
  {
    id: "indian",
    labels: ["印度料理", "indian"],
    // Bare 印度 is a country destination — require food surface.
    patterns: [/印度料理|印度菜|印度餐|indian\s*(?:food|cuisine|restaurant)/i],
  },
  {
    id: "vegetarian",
    labels: ["素食", "vegetarian"],
    patterns: [/素食|蔬食|vegetarian|vegan/i],
  },
  {
    id: "halal",
    labels: ["清真料理", "halal"],
    patterns: [/清真|halal/i],
  },
  {
    id: "seafood",
    labels: ["海鮮", "seafood"],
    patterns: [/海鮮|海鲜|seafood/i],
  },
  {
    id: "grill",
    labels: ["燒烤", "grill"],
    patterns: [/燒烤|烧烤|grill|bbq\s*grill/i],
  },
  {
    id: "buffet",
    labels: ["吃到飽", "buffet"],
    patterns: [/吃到飽|吃到饱|自助餐|buffet/i],
  },
  {
    id: "dessert",
    labels: ["甜點", "dessert"],
    patterns: [/甜點|甜点|dessert|蛋糕|cake/i],
  },
  {
    id: "ice_cream",
    labels: ["冰品", "ice cream"],
    patterns: [/冰品|冰淇淋|冰激凌|ice\s*cream|gelato/i],
  },
  {
    id: "local",
    labels: ["當地料理", "在地料理"],
    patterns: [/當地料理|当地料理|在地料理|本地料理|local\s*cuisine/i],
  },
];

const SHOPPING_TYPES: Array<{ id: string; labels: string[]; patterns: RegExp[] }> = [
  {
    id: "department_store",
    labels: ["百貨公司", "百貨"],
    patterns: [/百貨公司|百貨|デパート|department\s*store/i],
  },
  {
    id: "underground_mall",
    labels: ["地下街"],
    patterns: [/地下街|地下商場|chikagai|underground\s*mall/i],
  },
  {
    id: "outlet",
    labels: ["Outlet", "アウトレット"],
    patterns: [/outlet|アウトレット/i],
  },
  {
    id: "shopping_street",
    labels: ["商店街"],
    patterns: [/商店街|shotengai|shopping\s*street/i],
  },
  {
    id: "souvenir",
    labels: ["伴手禮"],
    patterns: [/伴手禮|伴手礼|紀念品|纪念品|souvenir/i],
  },
  {
    id: "stationery",
    labels: ["文具店"],
    patterns: [/文具|stationery/i],
  },
  {
    id: "local_brand",
    labels: ["當地品牌"],
    patterns: [/當地品牌|当地品牌|在地品牌|local\s*brand/i],
  },
  {
    id: "budget_fashion",
    labels: ["平價服飾"],
    patterns: [/平價服飾|平价服饰|平價衣|快時尚|uniqlo|gu\b/i],
  },
  {
    id: "luxury",
    labels: ["精品"],
    patterns: [/精品|奢侈|luxury|designer/i],
  },
  {
    id: "indoor_mall",
    labels: ["室內商城", "購物中心"],
    patterns: [/室內商城|室内商城|購物中心|购物中心|shopping\s*mall|商場/i],
  },
];

const ATTRACTION_TYPES: Array<{ id: string; labels: string[]; patterns: RegExp[] }> = [
  {
    id: "indoor",
    labels: ["室內景點"],
    patterns: [/室內景點|室内景点|室內的|室内的|indoor/i],
  },
  {
    id: "night_view",
    labels: ["夜景"],
    patterns: [/夜景|night\s*view|nightscape/i],
  },
  {
    id: "culture",
    labels: ["文化景點"],
    patterns: [/文化景點|文化景点|文化|博物館|博物|美術館|museum|gallery/i],
  },
  {
    id: "nature",
    labels: ["自然景點"],
    patterns: [/自然景點|自然景点|自然|公園|森林|lake|nature/i],
  },
  {
    id: "family",
    labels: ["親子景點"],
    patterns: [/親子|亲子|family|小孩|帶小孩/i],
  },
  {
    id: "rainy_day",
    labels: ["雨天景點"],
    patterns: [/雨天|下雨|下雨天|rainy/i],
  },
  {
    id: "local",
    labels: ["在地景點"],
    patterns: [/在地景點|在地景点|當地景點|当地景点|local\s*(?:spot|attraction)/i],
  },
];

const CAFE_ATMOSPHERE: Array<{ id: string; patterns: RegExp[] }> = [
  { id: "quiet", patterns: [/安靜|安静|quiet|寧靜|宁静/i] },
  { id: "dessert", patterns: [/甜點店|甜点店|甜點好吃|甜點|dessert/i] },
  { id: "view", patterns: [/景觀咖啡|景观咖啡|景觀|view\s*cafe|scenic/i] },
  { id: "power_outlet", patterns: [/有插座|插座|電源|电源|充電|charging|power\s*outlet/i] },
  { id: "sofa", patterns: [/有沙發|沙發|沙发|sofa|lounge\s*seat/i] },
  { id: "no_sofa_ok", patterns: [/沒有沙發也可以|没有沙发也可以|沒沙發也行|没有沙发也行/i] },
  { id: "wifi", patterns: [/有\s*Wi-?Fi|有wifi|Wi-?Fi|無線網路|无线网络/i] },
  { id: "work", patterns: [/適合工作|适合工作|適合用電腦|适合用电脑|上班|筆電|笔电|laptop|work\s*friendly|coworking/i] },
  { id: "chat", patterns: [/適合聊天|适合聊天|聊天/i] },
  { id: "read", patterns: [/適合讀書|适合读书|適合看書|适合看书|讀書|看书/i] },
  { id: "photo", patterns: [/適合拍照|适合拍照|好拍|打卡|instagram|photo/i] },
  { id: "late", patterns: [/營業到晚|营业到晚|開到晚|开到晚|深夜營業|深夜营业|深夜|晚一點|晚一点|open\s*late|late\s*night/i] },
  { id: "brunch", patterns: [/有早午餐|早午餐|brunch/i] },
  { id: "no_time_limit", patterns: [/不限時|不限时|無限時|无限时|no\s*time\s*limit/i] },
  { id: "pet_friendly", patterns: [/寵物友善|宠物友善|可帶寵物|可带宠物|pet\s*friendly/i] },
  { id: "solo", patterns: [/適合一個人|适合一个人|一個人|一个人|solo/i] },
  { id: "group", patterns: [/適合多人|适合多人|多人|團體|团体/i] },
  { id: "outdoor", patterns: [/有戶外座位|户外座位|戶外座|outdoor\s*seat/i] },
  { id: "indoor_seat", patterns: [/室內座位|室内座位|indoor\s*seat/i] },
  { id: "long_stay", patterns: [/適合久坐|适合久坐|久坐/i] },
  { id: "reservation", patterns: [/可預約|可预约|能預約|reservation/i] },
  { id: "near_station", patterns: [/靠近車站|靠近车站|車站附近|near\s*station/i] },
];

/** Preferred cafe equipment / amenity feature ids (subset of atmosphere). */
const CAFE_FEATURE_IDS = new Set([
  "quiet",
  "dessert",
  "view",
  "sofa",
  "power_outlet",
  "wifi",
  "work",
  "chat",
  "read",
  "late",
  "no_time_limit",
  "pet_friendly",
  "outdoor",
  "indoor_seat",
  "long_stay",
  "reservation",
  "near_station",
  "brunch",
]);

const EXCLUSION_PATTERNS: Array<{ keywords: string[]; patterns: RegExp[] }> = [
  {
    keywords: ["火鍋", "hotpot"],
    patterns: [/不要火鍋|不要火锅|別給火鍋|别给火锅|不要吃火鍋/i],
  },
  {
    keywords: ["義式", "italian"],
    patterns: [/不要義式|不要义式|不要義大利|不要意大利|不要披薩|不要pizza/i],
  },
  {
    keywords: ["連鎖店", "chain"],
    patterns: [/不要連鎖|不要连锁|別推連鎖|别推连锁|不要chain|不要連鎖店|不要连锁店/i],
  },
  {
    keywords: ["迴轉壽司", "conveyor_sushi"],
    patterns: [/不要迴轉壽司|不要回转寿司|不要回転寿司|別推迴轉|别推回转/i],
  },
  {
    keywords: ["吃到飽", "buffet"],
    patterns: [/不要吃到飽|不要吃到饱|別吃到飽|别吃到饱|不要buffet|不要自助餐/i],
  },
  {
    keywords: ["公園", "park"],
    patterns: [/不要公園|不要公园|別推公園|别推公园|不要park/i],
  },
  {
    keywords: ["市場", "market"],
    patterns: [/不要市場|不要市场|別推市場|别推市场/i],
  },
  {
    keywords: ["太觀光", "tourist"],
    patterns: [/不要太觀光|不要太观光|別太觀光|别太观光|不要觀光客|不要游客/i],
  },
  {
    keywords: ["排隊", "queue", "wait"],
    patterns: [/不要排隊|不要排队|別排隊|别排队|不要排太久|排隊太久|排队太久/i],
  },
  {
    keywords: ["Outlet", "outlet"],
    patterns: [/不要\s*Outlet|不要アウトレット|別推\s*Outlet/i],
  },
];

const GENERIC_EXCLUSION_CAPTURE =
  /(?:不要|別要|别要|別給|别给|不想要|不想吃|別推|别推)\s*([^\s，,。.!！？?]{1,12})/g;

const INTENT_SWITCH_PATTERNS: Array<{ intent: RecommendationIntent; patterns: RegExp[] }> = [
  {
    intent: "cafe",
    patterns: [/改找咖啡|換成咖啡|换成咖啡|改成咖啡|想找咖啡廳|想找咖啡厅|改推薦咖啡/i],
  },
  {
    intent: "restaurant",
    patterns: [/改找餐廳|改找餐馆|換成餐廳|换成餐厅|改成餐廳|想找餐廳|改推薦餐廳/i],
  },
  {
    intent: "shopping",
    patterns: [/改找購物|改找逛街|換成購物|换成购物|改成逛街|想逛街|改推薦商圈|改找百貨/i],
  },
  {
    intent: "attraction",
    patterns: [/改找景點|換成景點|换成景点|改成景點|想找景點|改推薦景點/i],
  },
  {
    intent: "nightlife",
    patterns: [/改找酒吧|改找夜生活|換成酒吧|换成酒吧|想找酒吧|晚上想去酒吧/i],
  },
  {
    intent: "indoor",
    patterns: [/改找室內|改找室内|換成室內|换成室内|想找室內景點/i],
  },
];

const CITY_SCOPE_RE =
  /(?:^|[，,\s])([\u4e00-\u9fff]{2,6})(?:有嗎|有没有|有沒有|那邊|那边|附近)(?:[？?！!。.]|$)/;

const KNOWN_CITY_TOKENS =
  /(?:札幌|小樽|函館|旭川|帶廣|带广|釧路|钏路|東京|大阪|京都|福岡|名古屋|橫濱|横浜|那霸|首爾|釜山|台北|臺北|台中|高雄|台南)/;

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

function parseBudget(text: string): RecommendationBudget | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const perPerson = t.match(
    /(?:每人|一位|一位客人)?(?:不超過|不超过|以內|以内|預算|预算)\s*[￥¥$]?\s*(\d{2,6})/,
  );
  if (perPerson?.[1]) {
    const max = Number(perPerson[1]);
    if (Number.isFinite(max) && max > 0) {
      return { level: "cheap", max, currency: "local" };
    }
  }

  const budgetOnly = t.match(/(?:預算|预算)\s*[￥¥$]?\s*(\d{2,6})/);
  if (budgetOnly?.[1]) {
    const max = Number(budgetOnly[1]);
    if (Number.isFinite(max) && max > 0) {
      return { level: "moderate", max, currency: "local" };
    }
  }

  let level: RecommendationBudgetLevel | undefined;
  if (/(?:便宜一點|便宜一点|便宜些|便宜的|省錢|省钱|平價|平价|小資|小资|低預算|低预算|不要太貴|不要太贵)/i.test(t)) {
    level = "cheap";
  } else if (/(?:中等|中價|中价|普通價位)/i.test(t)) {
    level = "moderate";
  } else if (/(?:高級|高级|高端|奢華|奢华|premium|luxury)/i.test(t)) {
    level = "premium";
  }
  if (!level) return undefined;
  return { level };
}

function parseMealSlot(text: string): RecommendationMealSlot | undefined {
  const t = text.trim();
  if (/(?:宵夜|深夜食堂|late\s*night)/i.test(t)) return "late_night";
  if (/(?:早餐|早饭|breakfast)/i.test(t)) return "breakfast";
  if (/(?:午餐|午饭|中餐|中午|lunch)/i.test(t)) return "lunch";
  if (/(?:晚餐|晚饭|晚上吃|dinner)/i.test(t)) return "dinner";
  return undefined;
}

function parsePositivePrefs(text: string): Partial<RecommendationRefinementPatch> {
  const patch: Partial<RecommendationRefinementPatch> = {};
  const atmosphere: string[] = [];
  const companion: string[] = [];
  const preferred: string[] = [];

  if (/(?:評價高|评价高|分數高|分数高|高評價|高评价|rating)/i.test(text)) {
    patch.highRatingPreferred = true;
    preferred.push("high_rating");
  }
  if (/(?:安靜一點|安静一点|安靜些|安静些|安靜的|安静的|quiet)/i.test(text)) {
    patch.quietOnly = true;
    atmosphere.push("quiet");
  }
  if (/(?:在地一點|在地一点|當地一點|当地一点|local)/i.test(text)) {
    atmosphere.push("local");
    preferred.push("local");
  }
  if (/(?:適合一個人|适合一个人|一個人吃|一个人吃|solo)/i.test(text)) {
    patch.soloFriendly = true;
    companion.push("solo");
  }
  if (/(?:適合家庭|适合家庭|親子|亲子|帶小孩|带小孩|family)/i.test(text)) {
    patch.familyFriendly = true;
    companion.push("family");
  }
  if (/(?:可以訂位|可以订位|能訂位|能订位|要訂位|要订位|reservation)/i.test(text)) {
    patch.reservationPreferred = true;
    preferred.push("reservation");
  }
  if (/(?:離車站近|离车站近|車站附近|车站附近|近車站|近车站|near\s*(?:the\s*)?station)/i.test(text)) {
    patch.nearStation = true;
    preferred.push("near_station");
  }
  if (/(?:步行可到|走路可到|走得到|walkable|walking\s*distance)/i.test(text)) {
    patch.walkable = true;
    preferred.push("walkable");
  }
  if (/(?:營業到晚|营业到晚|開到晚|开到晚|晚一點|晚一点|open\s*late)/i.test(text)) {
    atmosphere.push("open_late");
    preferred.push("open_late");
  }
  if (/(?:現在營業|现在营业|營業中|营业中|open\s*now)/i.test(text)) {
    patch.openNow = true;
  }
  if (/(?:晚上可以去|晚上能去|晚上適合|晚上适合)/i.test(text)) {
    atmosphere.push("evening");
    preferred.push("evening");
  }
  if (/(?:有插座|插座|電源|电源)/i.test(text)) {
    atmosphere.push("power_outlet");
    preferred.push("power_outlet");
  }
  if (/(?:有沙發|沙發|沙发|sofa)/i.test(text)) {
    atmosphere.push("sofa");
    preferred.push("sofa");
  }
  if (/(?:適合工作|适合工作|適合用電腦|适合用电脑|筆電|笔电)/i.test(text)) {
    atmosphere.push("work");
    preferred.push("work");
  }
  if (/(?:適合久坐|适合久坐|久坐)/i.test(text)) {
    atmosphere.push("long_stay");
    preferred.push("long_stay");
  }
  if (/(?:室內|室内|indoor)/i.test(text) && !/(?:改找)/.test(text)) {
    patch.indoorOnly = true;
    preferred.push("indoor");
  }

  if (atmosphere.length) patch.atmosphere = uniq(atmosphere);
  if (companion.length) patch.companion = uniq(companion);
  if (preferred.length) patch.preferredKeywords = uniq(preferred);
  return patch;
}

function parseExclusions(text: string): string[] {
  const out: string[] = [];
  for (const def of EXCLUSION_PATTERNS) {
    if (def.patterns.some((re) => re.test(text))) {
      out.push(...def.keywords);
    }
  }
  GENERIC_EXCLUSION_CAPTURE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GENERIC_EXCLUSION_CAPTURE.exec(text)) != null) {
    const token = (match[1] ?? "").trim();
    if (!token) continue;
    // Skip if this looks like a positive preference fragment already handled
    if (/^(一點|一点|太|比較|比较)$/.test(token)) continue;
    out.push(token);
  }
  return uniq(out);
}

function parseCuisines(text: string): string[] {
  // Avoid treating exclusion of cuisine as positive cuisine
  if (/不要|別要|别要|不想吃|別推|别推/.test(text) && !/想找|想吃|要找/.test(text)) {
    // Still allow「想找壽喜燒，不要吃到飽」
  }
  const found: string[] = [];
  for (const def of RESTAURANT_CUISINES) {
    if (!def.patterns.some((re) => re.test(text))) continue;
    // Skip if this cuisine is being excluded
    const excluded = def.labels.some((label) =>
      new RegExp(`(?:不要|別要|别要|不想吃|別推|别推)\\s*${label}`, "i").test(text),
    );
    if (excluded) continue;
    found.push(def.id);
  }
  return uniq(found);
}

function parseShoppingTypes(text: string): string[] {
  const found: string[] = [];
  for (const def of SHOPPING_TYPES) {
    if (!def.patterns.some((re) => re.test(text))) continue;
    const excluded = def.labels.some((label) =>
      new RegExp(`(?:不要|別要|别要|別推|别推)\\s*${label}`, "i").test(text),
    );
    if (excluded) continue;
    found.push(def.id);
  }
  return uniq(found);
}

function parseAttractionTypes(text: string): string[] {
  const found: string[] = [];
  for (const def of ATTRACTION_TYPES) {
    if (def.patterns.some((re) => re.test(text))) found.push(def.id);
  }
  return uniq(found);
}

function parseCafeAtmosphere(text: string): string[] {
  const found: string[] = [];
  for (const def of CAFE_ATMOSPHERE) {
    if (def.patterns.some((re) => re.test(text))) found.push(def.id);
  }
  return uniq(found);
}

function parseIntentSwitch(text: string): RecommendationIntent | undefined {
  for (const def of INTENT_SWITCH_PATTERNS) {
    if (def.patterns.some((re) => re.test(text))) return def.intent;
  }
  return undefined;
}

function parseSearchCityOverride(text: string): string | undefined {
  const m = text.trim().match(CITY_SCOPE_RE);
  if (!m?.[1]) return undefined;
  const city = m[1].trim();
  if (!KNOWN_CITY_TOKENS.test(city)) return undefined;
  return city;
}

function hasAnyRefinementSignal(patch: RecommendationRefinementPatch): boolean {
  return Boolean(
    patch.intentSwitch ||
      patch.cuisine?.length ||
      patch.shoppingTypes?.length ||
      patch.attractionTypes?.length ||
      patch.budget ||
      patch.atmosphere?.length ||
      patch.companion?.length ||
      patch.mealSlot ||
      patch.openNow ||
      patch.indoorOnly ||
      patch.quietOnly ||
      patch.reservationPreferred ||
      patch.soloFriendly ||
      patch.familyFriendly ||
      patch.nearStation ||
      patch.walkable ||
      patch.highRatingPreferred ||
      patch.preferredKeywords?.length ||
      patch.excludedKeywords?.length ||
      patch.searchCityOverride ||
      patch.isMoreResults ||
      patch.category ||
      patch.subcategory,
  );
}

/**
 * Parse user text into a refinement patch.
 * Returns null when the text is not a recommendation refinement.
 */
export function parseRecommendationRefinement(
  text: string,
  activeIntent?: RecommendationIntent | null,
): RecommendationRefinementPatch | null {
  const t = text.trim();
  if (!t) return null;

  const intentSwitch = parseIntentSwitch(t);
  const cuisine = parseCuisines(t);
  const shoppingTypes = parseShoppingTypes(t);
  const attractionTypes = parseAttractionTypes(t);
  const cafeAtmosphere = parseCafeAtmosphere(t);
  const budget = parseBudget(t);
  const mealSlot = parseMealSlot(t);
  const exclusions = parseExclusions(t);
  const positive = parsePositivePrefs(t);
  const searchCityOverride = parseSearchCityOverride(t);
  const isMoreResults = matchesContinueRecommendationGrammar(t);

  const atmosphere = uniq([
    ...(positive.atmosphere ?? []),
    ...cafeAtmosphere,
  ]);

  let category: string | undefined;
  let subcategory: string | undefined;
  if (cuisine.length) {
    category = "restaurant";
    subcategory = cuisine[0];
  } else if (shoppingTypes.length) {
    category = "shopping";
    subcategory = shoppingTypes[0];
  } else if (attractionTypes.length) {
    category = "attraction";
    subcategory = attractionTypes[0];
  } else if (cafeAtmosphere.length || intentSwitch === "cafe") {
    category = "cafe";
    subcategory = cafeAtmosphere[0];
  }

  // Soft cuisine phrasing without explicit「餐廳」— treat as restaurant refinement when
  // active intent is restaurant OR text looks like dish seeking.
  const dishSeeking =
    cuisine.length > 0 &&
    /(?:想找|想吃|找|要吃|吃|晚餐|午餐|早餐)/.test(t);

  const patch: RecommendationRefinementPatch = {
    intentSwitch,
    category,
    subcategory,
    cuisine: cuisine.length ? cuisine : undefined,
    shoppingTypes: shoppingTypes.length ? shoppingTypes : undefined,
    attractionTypes: attractionTypes.length ? attractionTypes : undefined,
    budget,
    atmosphere: atmosphere.length ? atmosphere : undefined,
    companion: positive.companion,
    mealSlot,
    openNow: positive.openNow,
    indoorOnly: positive.indoorOnly ?? (attractionTypes.includes("indoor") ? true : undefined),
    quietOnly: positive.quietOnly,
    reservationPreferred: positive.reservationPreferred,
    soloFriendly: positive.soloFriendly,
    familyFriendly: positive.familyFriendly,
    nearStation: positive.nearStation,
    walkable: positive.walkable,
    highRatingPreferred: positive.highRatingPreferred,
    preferredKeywords: positive.preferredKeywords,
    excludedKeywords: exclusions.length ? exclusions : undefined,
    searchCityOverride,
    isMoreResults: isMoreResults || undefined,
    confidence: 0,
  };

  if (!hasAnyRefinementSignal(patch)) return null;

  // Confidence: higher when dish/type keywords or explicit more-results
  let confidence = 0.55;
  if (intentSwitch) confidence = 0.95;
  else if (dishSeeking || cuisine.length || shoppingTypes.length) confidence = 0.9;
  else if (exclusions.length || budget) confidence = 0.85;
  else if (isMoreResults) confidence = 0.8;
  else if (atmosphere.length || mealSlot || positive.soloFriendly) confidence = 0.75;
  else if (activeIntent) confidence = 0.65;
  patch.confidence = confidence;

  return patch;
}

/** True when text is a refinement relative to an active recommendation context. */
export function isRecommendationRefinementText(
  text: string,
  activeIntent?: RecommendationIntent | null,
): boolean {
  return parseRecommendationRefinement(text, activeIntent) != null;
}

export function isMoreRecommendationResultsText(text: string): boolean {
  return matchesContinueRecommendationGrammar(text);
}

/** Cuisine id → multilingual search tokens */
export function cuisineSearchTokens(cuisineId: string): string[] {
  const def = RESTAURANT_CUISINES.find((c) => c.id === cuisineId);
  return def?.labels ?? [cuisineId];
}

export function shoppingTypeSearchTokens(typeId: string): string[] {
  const def = SHOPPING_TYPES.find((c) => c.id === typeId);
  return def?.labels ?? [typeId];
}

export function attractionTypeSearchTokens(typeId: string): string[] {
  const def = ATTRACTION_TYPES.find((c) => c.id === typeId);
  return def?.labels ?? [typeId];
}

export { RESTAURANT_CUISINES, SHOPPING_TYPES, ATTRACTION_TYPES, CAFE_FEATURE_IDS, CAFE_ATMOSPHERE };
