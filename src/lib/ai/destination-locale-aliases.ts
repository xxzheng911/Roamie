import { localizedCountryReference, localizedCountryName } from "./destination-country-normalize";
import { EN_CITY_NAMES } from "./destination-geocode";
/**
 * Locale / alias normalization for travel destinations.
 * Maps English, kana, and common variants → canonical zh labels used by the app.
 * Generic mechanism — not city-specific business logic.
 */

/** Kana / romaji / English variants → canonical destination label */
const CITY_LOCALE_ALIASES: Record<string, string> = {
  "chiang mai": "清邁",
  チェンマイ: "清邁",
  치앙마이: "清邁",
  プーケット: "普吉島",
  푸켓: "普吉島",
  サムイ島: "蘇梅島",
  코사무이: "蘇梅島",
  バンコク: "曼谷",
  방콕: "曼谷",
  도쿄: "東京",
  오사카: "大阪",
  서울: "首爾",
  부산: "釜山",
  제주: "濟州",
  제주도: "濟州",
  경주: "慶州",
  강릉: "江陵",
  교토: "京都",
  나고야: "名古屋",
  후쿠오카: "福岡",
  요코하마: "橫濱",
  삿포로: "札幌",
  홋카이도: "北海道",
  오키나와: "沖繩",
  고베: "神戶",
  홍콩: "香港",
  마카오: "澳門",
  싱가포르: "新加坡",
  다낭: "峴港",
  타이베이: "台北",
  런던: "倫敦",
  뉴욕: "紐約",
  시드니: "雪梨",
  // Japan
  tokyo: "東京",
  "tokyo city": "東京",
  とうきょう: "東京",
  トウキョウ: "東京",
  osaka: "大阪",
  "osaka city": "大阪",
  おおさか: "大阪",
  オオサカ: "大阪",
  kyoto: "京都",
  "kyoto city": "京都",
  きょうと: "京都",
  キョウト: "京都",
  nagoya: "名古屋",
  "nagoya city": "名古屋",
  なごや: "名古屋",
  ナゴヤ: "名古屋",
  yokohama: "橫濱",
  "yokohama city": "橫濱",
  よこはま: "橫濱",
  ヨコハマ: "橫濱",
  fukuoka: "福岡",
  "fukuoka city": "福岡",
  ふくおか: "福岡",
  フクオカ: "福岡",
  kumamoto: "熊本",
  "kumamoto city": "熊本",
  くまもと: "熊本",
  hiroshima: "廣島",
  "hiroshima city": "廣島",
  nagasaki: "長崎",
  kagoshima: "鹿兒島",
  sendai: "仙台",
  kanazawa: "金澤",
  kobe: "神戶",
  nara: "奈良",
  hakodate: "函館",
  otaru: "小樽",
  sapporo: "札幌",
  さっぽろ: "札幌",
  okinawa: "沖繩",
  おきなわ: "沖繩",
  沖縄: "沖繩",
  hokkaido: "北海道",
  ほっかいどう: "北海道",
  florence: "佛羅倫斯",
  firenze: "佛羅倫斯",
  alishan: "阿里山",
  // Korea
  seoul: "首爾",
  "seoul city": "首爾",
  ソウル: "首爾",
  busan: "釜山",
  // Taiwan
  taipei: "台北",
  "taipei city": "台北",
  "new taipei": "新北",
  "new taipei city": "新北",
  kaohsiung: "高雄",
  "kaohsiung city": "高雄",
  taichung: "台中",
  tainan: "台南",
  // Other common travel cities
  melbourne: "墨爾本",
  "melbourne city": "墨爾本",
  paris: "巴黎",
  "paris city": "巴黎",
  london: "倫敦",
  sydney: "雪梨",
  bangkok: "曼谷",
  singapore: "新加坡",
  barcelona: "巴塞隆納",
  "barcelona city": "巴塞隆納",
  "da nang": "峴港",
  danang: "峴港",
  // Greater China
  shenzhen: "深圳",
  "shenzhen city": "深圳",
  深圳市: "深圳",
  guangzhou: "廣州",
  "guangzhou city": "廣州",
  shanghai: "上海",
  beijing: "北京",
  // Thailand islands / regions
  phuket: "普吉島",
  "phuket island": "普吉島",
  "phuket province": "普吉島",
  "koh samui": "蘇梅島",
  "ko samui": "蘇梅島",
  samui: "蘇梅島",
  "samui island": "蘇梅島",
  pattaya: "芭達雅",
  "pattaya city": "芭達雅",
  芭堤雅: "芭達雅",
  巴達雅: "芭達雅",
  帕塔雅: "芭達雅",
  พัทยา: "芭達雅",
  // Indonesia / Japan / Korea / SE Asia
  bali: "峇里島",
  "bali island": "峇里島",
  峇厘島: "峇里島",
  峇里島: "峇里島",
  jeju: "濟州",
  "jeju island": "濟州",
  "jeju-do": "濟州",
  cebu: "宿霧",
  boracay: "長灘島",
  "phu quoc": "富國島",
  langkawi: "蘭卡威",
  santorini: "聖托里尼",
  mallorca: "馬略卡島",
  majorca: "馬略卡島",
  tasmania: "塔斯馬尼亞",
  "north male atoll": "北馬累環礁",
  "north malé atoll": "北馬累環礁",
  hawaii: "夏威夷",
  maldives: "馬爾地夫",
};

/**
 * Apply locale aliases after administrative-suffix stripping.
 * Case-insensitive for Latin script; exact match for kana.
 */
export function applyCityLocaleAlias(label: string): string {
  const raw = label.trim();
  if (!raw) return raw;
  if (CITY_LOCALE_ALIASES[raw]) return CITY_LOCALE_ALIASES[raw]!;
  const lower = raw.toLowerCase();
  if (CITY_LOCALE_ALIASES[lower]) return CITY_LOCALE_ALIASES[lower]!;
  const withoutCity = lower.replace(/\s+city$/, "").trim();
  if (withoutCity !== lower && CITY_LOCALE_ALIASES[withoutCity]) {
    return CITY_LOCALE_ALIASES[withoutCity]!;
  }
  return localizedCountryReference(raw)?.country ?? raw;
}

const LATIN_TRAVEL_ALIAS =
  /\b(?:i['’]d like to go to|i would like to go to|i want to go to|(?:i['’]m|i am|we['’]re|we are) (?:going|travell?ing) to|let['’]s go to|planning a trip to|plan a trip to|travel to|going to|go to|visit)\s+([a-z][a-z .'-]{0,80})/i;

/**
 * Existing alias table only. Unknown place names are not guessed or translated.
 * `surface` is the user's own spelling; `canonical` is the routing label.
 */
export function extractKnownAliasDestination(
  text: string,
): { canonical: string; surface: string } | undefined {
  const direct = applyCityLocaleAlias(text);
  if (direct !== text.trim()) return {canonical:direct, surface:text.trim()};
  const asian = text.match(/(?:月に|월에)\s*(.+?)(?:へ|に|으로|로|에)\s*旅行|(?:월에)\s*(.+?)(?:으로|로|에)\s*여행/);
  if (asian) {
    const surface = (asian[1] ?? asian[2]).trim();
    const canonical = applyCityLocaleAlias(surface);
    if (canonical !== surface) return {canonical,surface};
  }
  // 「도쿄 여행」「도쿄 3일」"go Tokyo" "Tokyo trip": a known alias with only trip / days wording.
  const short =
    text.match(/^\s*([^\s\d]+?)(?:으로|로|에)?\s*(?:여행|旅行|\d+\s*(?:일|박|日))/u) ??
    text.match(/^\s*(?:let['’]s\s+)?go\s+([a-z][a-z .'-]{0,40}?)[.!?\s]*$/i) ??
    text.match(/^\s*([a-z][a-z .'-]{0,40}?)\s+trip\b/i);
  if (short?.[1]) {
    const surface = short[1].trim();
    const canonical = applyCityLocaleAlias(surface);
    if (canonical !== surface) return { canonical, surface };
  }
  const match = text.match(LATIN_TRAVEL_ALIAS);
  const tail = match?.[1]?.trim();
  if (!tail) return undefined;
  const countryText = tail.replace(/\s+(?:in|for|this|next)\b.*$/i, '').replace(/[.!?]+$/, '').trim();
  const country = localizedCountryReference(countryText);
  if (country) return {canonical:country.country, surface:countryText};
  const aliases = Object.keys(CITY_LOCALE_ALIASES)
    .filter((key) => /^[a-z0-9][a-z0-9 .'-]*$/i.test(key))
    .sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = tail.match(new RegExp(`^${escaped}(?![a-z])`, "i"));
    const canonical = found ? CITY_LOCALE_ALIASES[alias] : undefined;
    if (found && canonical) return { canonical, surface: found[0] };
  }
  return undefined;
}

/**
 * Display-only ja / ko names for canonical labels (copy only; never used for routing,
 * evidence matching, or alias resolution).
 */
const CITY_DISPLAY_NAMES: Record<string, { ja: string; ko?: string; en?: string }> = {
  // Country-advice cities, style-guide hot routes, and EN_CITY_NAMES rows without a ja/ko form.
  // ja: katakana / Japanese conventional names for foreign places; shinjitai for kanji places.
  濟州島: { ja: "済州島", ko: "제주도", en: "Jeju Island" },
  江原道: { ja: "江原道", ko: "강원도", en: "Gangwon" },
  慶州: { ja: "慶州", ko: "경주", en: "Gyeongju" },
  仁川: { ja: "仁川", ko: "인천", en: "Incheon" },
  喀比: { ja: "クラビ", ko: "크라비", en: "Krabi" },
  普吉: { ja: "プーケット", ko: "푸켓", en: "Phuket" },
  蘇梅: { ja: "サムイ島", ko: "코사무이", en: "Koh Samui" },
  河內: { ja: "ハノイ", ko: "하노이", en: "Hanoi" },
  胡志明: { ja: "ホーチミン", ko: "호찌민", en: "Ho Chi Minh City" },
  濱海灣: { ja: "マリーナベイ", ko: "마리나 베이", en: "Marina Bay" },
  牛車水: { ja: "チャイナタウン", ko: "차이나타운", en: "Chinatown" },
  聖淘沙: { ja: "セントーサ島", ko: "센토사", en: "Sentosa" },
  羅馬: { ja: "ローマ", ko: "로마", en: "Rome" },
  米蘭: { ja: "ミラノ", ko: "밀라노", en: "Milan" },
  威尼斯: { ja: "ヴェネツィア", ko: "베네치아", en: "Venice" },
  普羅旺斯: { ja: "プロヴァンス", ko: "프로방스", en: "Provence" },
  蔚藍海岸: { ja: "コート・ダジュール", ko: "코트다쥐르", en: "French Riviera" },
  烏蘭巴托: { ja: "ウランバートル", ko: "울란바토르", en: "Ulaanbaatar" },
  特勒吉: { ja: "テレルジ", ko: "테렐지", en: "Terelj" },
  特勒吉國家公園: { ja: "テレルジ国立公園", ko: "테렐지 국립공원", en: "Gorkhi-Terelj National Park" },
  哈拉和林: { ja: "カラコルム", ko: "카라코룸", en: "Kharkhorin" },
  戈壁: { ja: "ゴビ", ko: "고비", en: "Gobi" },
  戈壁沙漠: { ja: "ゴビ砂漠", ko: "고비 사막", en: "Gobi Desert" },
  草原蒙古包體驗: { ja: "草原のゲル体験", ko: "초원 게르 체험", en: "Grassland ger stay" },
  紐約: { ja: "ニューヨーク", ko: "뉴욕", en: "New York" },
  洛杉磯: { ja: "ロサンゼルス", ko: "로스앤젤레스", en: "Los Angeles" },
  舊金山: { ja: "サンフランシスコ", ko: "샌프란시스코", en: "San Francisco" },
  拉斯維加斯: { ja: "ラスベガス", ko: "라스베이거스", en: "Las Vegas" },
  愛丁堡: { ja: "エディンバラ", ko: "에든버러", en: "Edinburgh" },
  曼徹斯特: { ja: "マンチェスター", ko: "맨체스터", en: "Manchester" },
  湖區: { ja: "湖水地方", ko: "레이크 디스트릭트", en: "Lake District" },
  阿姆斯特丹: { ja: "アムステルダム", ko: "암스테르담", en: "Amsterdam" },
  鹿特丹: { ja: "ロッテルダム", ko: "로테르담", en: "Rotterdam" },
  海牙: { ja: "ハーグ", ko: "헤이그", en: "The Hague" },
  烏得勒支: { ja: "ユトレヒト", ko: "위트레흐트", en: "Utrecht" },
  柏林: { ja: "ベルリン", ko: "베를린", en: "Berlin" },
  慕尼黑: { ja: "ミュンヘン", ko: "뮌헨", en: "Munich" },
  漢堡: { ja: "ハンブルク", ko: "함부르크", en: "Hamburg" },
  科隆: { ja: "ケルン", ko: "쾰른", en: "Cologne" },
  馬德里: { ja: "マドリード", ko: "마드리드", en: "Madrid" },
  塞維亞: { ja: "セビリア", ko: "세비야", en: "Seville" },
  瓦倫西亞: { ja: "バレンシア", ko: "발렌시아", en: "Valencia" },
  布里斯本: { ja: "ブリスベン", ko: "브리즈번", en: "Brisbane" },
  黃金海岸: { ja: "ゴールドコースト", ko: "골드코스트", en: "Gold Coast" },
  溫哥華: { ja: "バンクーバー", ko: "밴쿠버", en: "Vancouver" },
  多倫多: { ja: "トロント", ko: "토론토", en: "Toronto" },
  蒙特婁: { ja: "モントリオール", ko: "몬트리올", en: "Montreal" },
  班夫: { ja: "バンフ", ko: "밴프", en: "Banff" },
  香港: { ja: "香港", ko: "홍콩", en: "Hong Kong" },
  澳門: { ja: "マカオ", ko: "마카오", en: "Macau" },
  九州: { ja: "九州", ko: "규슈", en: "Kyushu" },
  巴拉望: { ja: "パラワン島", ko: "팔라완", en: "Palawan" },
  龍目島: { ja: "ロンボク島", ko: "롬복", en: "Lombok" },
  開羅: { ja: "カイロ", ko: "카이로", en: "Cairo" },
  盧克索: { ja: "ルクソール", ko: "룩소르", en: "Luxor" },
  紅海: { ja: "紅海", ko: "홍해", en: "Red Sea" },
  布拉格: { ja: "プラハ", ko: "프라하", en: "Prague" },
  墨西哥城: { ja: "メキシコシティ", ko: "멕시코시티", en: "Mexico City" },
  // Taiwan kanji stay readable in ja (shinjitai: 臺 → 台); ko keeps the existing Latin fallback.
  臺北: { ja: "台北", ko: "타이베이", en: "Taipei" },
  臺中: { ja: "台中", ko: "타이중", en: "Taichung" },
  臺南: { ja: "台南", ko: "타이난", en: "Tainan" },
  臺東: { ja: "台東", en: "Taitung" },
  日月潭: { ja: "日月潭", ko: "일월담", en: "Sun Moon Lake" },
  太魯閣: { ja: "タロコ", ko: "타이루거", en: "Taroko" },
  富士山: { ja: "富士山", ko: "후지산", en: "Mount Fuji" },
  // Nearby-extension labels (combination-selection fallback list + region-adjacency nodes).
  鎌倉: { ja: "鎌倉", ko: "가마쿠라", en: "Kamakura" },
  箱根: { ja: "箱根", ko: "하코네", en: "Hakone" },
  輕井澤: { ja: "軽井沢", ko: "가루이자와", en: "Karuizawa" },
  河口湖: { ja: "河口湖", ko: "가와구치코", en: "Lake Kawaguchi" },
  日光: { ja: "日光", ko: "닛코", en: "Nikko" },
  千葉: { ja: "千葉", ko: "지바", en: "Chiba" },
  川崎: { ja: "川崎", ko: "가와사키", en: "Kawasaki" },
  大宮: { ja: "大宮", ko: "오미야", en: "Omiya" },
  埼玉: { ja: "埼玉", ko: "사이타마", en: "Saitama" },
  熱海: { ja: "熱海", ko: "아타미", en: "Atami" },
  伊豆: { ja: "伊豆", ko: "이즈", en: "Izu" },
  宇治: { ja: "宇治", ko: "우지", en: "Uji" },
  白濱: { ja: "白浜", ko: "시라하마", en: "Shirahama" },
  白浜: { ja: "白浜", ko: "시라하마", en: "Shirahama" },
  犬山: { ja: "犬山", ko: "이누야마", en: "Inuyama" },
  常滑: { ja: "常滑", ko: "도코나메", en: "Tokoname" },
  瀨戶: { ja: "瀬戸", ko: "세토", en: "Seto" },
  瀬戸: { ja: "瀬戸", ko: "세토", en: "Seto" },
  岡崎: { ja: "岡崎", ko: "오카자키", en: "Okazaki" },
  一宮: { ja: "一宮", ko: "이치노미야", en: "Ichinomiya" },
  岐阜: { ja: "岐阜", ko: "기후", en: "Gifu" },
  伊勢: { ja: "伊勢", ko: "이세", en: "Ise" },
  合掌造: { ja: "白川郷", ko: "시라카와고", en: "Shirakawa-go" },
  白川鄉: { ja: "白川郷", ko: "시라카와고", en: "Shirakawa-go" },
  // Taiwan: ko falls back to the English name (spec), so no ko value here.
  九份: { ja: "九份", en: "Jiufen" },
  淡水: { ja: "淡水", en: "Tamsui" },
  北投: { ja: "北投", en: "Beitou" },
  基隆: { ja: "基隆", en: "Keelung" },
  桃園: { ja: "桃園", en: "Taoyuan" },
  南投: { ja: "南投", en: "Nantou" },
  水原: { ja: "水原", ko: "수원", en: "Suwon" },
  城南: { ja: "城南", ko: "성남", en: "Seongnam" },
  大邱: { ja: "大邱", ko: "대구", en: "Daegu" },
  坡州: { ja: "坡州", ko: "파주", en: "Paju" },
  南怡島: { ja: "南怡島", ko: "남이섬", en: "Nami Island" },
  大城: { ja: "アユタヤ", ko: "아유타야", en: "Ayutthaya" },
  凡爾賽: { ja: "ヴェルサイユ", ko: "베르사유", en: "Versailles" },
  \u6e05\u9081: { ja: "\u30c1\u30a7\u30f3\u30de\u30a4", ko: "\uce58\uc559\ub9c8\uc774" },
  \u666e\u5409\u5cf6: { ja: "\u30d7\u30fc\u30b1\u30c3\u30c8", ko: "\ud478\ucf13" },
  \u8607\u6885\u5cf6: { ja: "\u30b5\u30e0\u30a4\u5cf6", ko: "\ucf54\uc0ac\ubb34\uc774" },
  \u66fc\u8c37: { ja: "\u30d0\u30f3\u30b3\u30af", ko: "\ubc29\ucf55" },
  \u6771\u4eac: { ja: "\u6771\u4eac", ko: "\ub3c4\ucfc4" },
  \u5927\u962a: { ja: "\u5927\u962a", ko: "\uc624\uc0ac\uce74" },
  \u9996\u723e: { ja: "\u30bd\u30a6\u30eb", ko: "\uc11c\uc6b8" },
  \u4eac\u90fd: { ja: "\u4eac\u90fd", ko: "\uad50\ud1a0" },
  \u540d\u53e4\u5c4b: { ja: "\u540d\u53e4\u5c4b", ko: "\ub098\uace0\uc57c" },
  \u6a6b\u6ff1: { ja: "\u6a2a\u6d5c", ko: "\uc694\ucf54\ud558\ub9c8" },
  \u798f\u5ca1: { ja: "\u798f\u5ca1", ko: "\ud6c4\ucfe0\uc624\uce74" },
  \u718a\u672c: { ja: "\u718a\u672c", ko: "\uad6c\ub9c8\ubaa8\ud1a0" },
  \u5ee3\u5cf6: { ja: "\u5e83\u5cf6", ko: "\ud788\ub85c\uc2dc\ub9c8" },
  \u9577\u5d0e: { ja: "\u9577\u5d0e", ko: "\ub098\uac00\uc0ac\ud0a4" },
  \u9e7f\u5152\u5cf6: { ja: "\u9e7f\u5150\u5cf6", ko: "\uac00\uace0\uc2dc\ub9c8" },
  \u4ed9\u53f0: { ja: "\u4ed9\u53f0", ko: "\uc13c\ub2e4\uc774" },
  \u91d1\u6fa4: { ja: "\u91d1\u6ca2", ko: "\uac00\ub098\uc790\uc640" },
  \u795e\u6236: { ja: "\u795e\u6238", ko: "\uace0\ubca0" },
  \u5948\u826f: { ja: "\u5948\u826f", ko: "\ub098\ub77c" },
  \u51fd\u9928: { ja: "\u51fd\u9928", ko: "\ud558\ucf54\ub2e4\ud14c" },
  \u5c0f\u6a3d: { ja: "\u5c0f\u6a3d", ko: "\uc624\ud0c0\ub8e8" },
  \u672d\u5e4c: { ja: "\u672d\u5e4c", ko: "\uc0bf\ud3ec\ub85c" },
  \u6c96\u7e69: { ja: "\u6c96\u7e04", ko: "\uc624\ud0a4\ub098\uc640" },
  \u5317\u6d77\u9053: { ja: "\u5317\u6d77\u9053", ko: "\ud64b\uce74\uc774\ub3c4" },
  \u4f5b\u7f85\u502b\u65af: { ja: "\u30d5\u30a3\u30ec\u30f3\u30c4\u30a7", ko: "\ud53c\ub80c\uccb4" },
  \u963f\u91cc\u5c71: { ja: "\u963f\u91cc\u5c71", ko: "\uc544\ub9ac\uc0b0" },
  \u91dc\u5c71: { ja: "\u91dc\u5c71", ko: "\ubd80\uc0b0" },
  \u53f0\u5317: { ja: "\u53f0\u5317", ko: "\ud0c0\uc774\ubca0\uc774" },
  \u65b0\u5317: { ja: "\u65b0\u5317", ko: "\uc2e0\ubca0\uc774" },
  \u9ad8\u96c4: { ja: "\u9ad8\u96c4", ko: "\uac00\uc624\uc29d" },
  \u53f0\u4e2d: { ja: "\u53f0\u4e2d", ko: "\ud0c0\uc774\uc911" },
  \u53f0\u5357: { ja: "\u53f0\u5357", ko: "\ud0c0\uc774\ub09c" },
  \u58a8\u723e\u672c: { ja: "\u30e1\u30eb\u30dc\u30eb\u30f3", ko: "\uba5c\ubc84\ub978" },
  \u5df4\u9ece: { ja: "\u30d1\u30ea", ko: "\ud30c\ub9ac" },
  \u502b\u6566: { ja: "\u30ed\u30f3\u30c9\u30f3", ko: "\ub7f0\ub358" },
  \u96ea\u68a8: { ja: "\u30b7\u30c9\u30cb\u30fc", ko: "\uc2dc\ub4dc\ub2c8" },
  \u65b0\u52a0\u5761: { ja: "\u30b7\u30f3\u30ac\u30dd\u30fc\u30eb", ko: "\uc2f1\uac00\ud3ec\ub974" },
  \u5df4\u585e\u9686\u7d0d: { ja: "\u30d0\u30eb\u30bb\u30ed\u30ca", ko: "\ubc14\ub974\uc140\ub85c\ub098" },
  \u5cf4\u6e2f: { ja: "\u30c0\u30ca\u30f3", ko: "\ub2e4\ub0ad" },
  \u6df1\u5733: { ja: "\u6df1\u5733", ko: "\uc120\uc804" },
  \u5ee3\u5dde: { ja: "\u5e83\u5dde", ko: "\uad11\uc800\uc6b0" },
  \u4e0a\u6d77: { ja: "\u4e0a\u6d77", ko: "\uc0c1\ud558\uc774" },
  \u5317\u4eac: { ja: "\u5317\u4eac", ko: "\ubca0\uc774\uc9d5" },
  \u82ad\u9054\u96c5: { ja: "\u30d1\u30bf\u30e4", ko: "\ud30c\ud0c0\uc57c" },
  \u5cc7\u91cc\u5cf6: { ja: "\u30d0\u30ea\u5cf6", ko: "\ubc1c\ub9ac" },
  \u6fdf\u5dde: { ja: "\u6e08\u5dde\u5cf6", ko: "\uc81c\uc8fc" },
  \u5bbf\u9727: { ja: "\u30bb\u30d6", ko: "\uc138\ubd80" },
  \u9577\u7058\u5cf6: { ja: "\u30dc\u30e9\u30ab\u30a4\u5cf6", ko: "\ubcf4\ub77c\uce74\uc774" },
  \u5bcc\u570b\u5cf6: { ja: "\u30d5\u30fc\u30b3\u30c3\u30af\u5cf6", ko: "\ud478\uafb8\uc625" },
  \u862d\u5361\u5a01: { ja: "\u30e9\u30f3\u30ab\u30a6\u30a4", ko: "\ub791\uce74\uc704" },
  \u8056\u6258\u91cc\u5c3c: { ja: "\u30b5\u30f3\u30c8\u30ea\u30fc\u30cb\u5cf6", ko: "\uc0b0\ud1a0\ub9ac\ub2c8" },
  \u99ac\u7565\u5361\u5cf6: { ja: "\u30de\u30e8\u30eb\u30ab\u5cf6", ko: "\ub9c8\uc694\ub974\uce74" },
  \u5854\u65af\u99ac\u5c3c\u4e9e: { ja: "\u30bf\u30b9\u30de\u30cb\u30a2", ko: "\ud0dc\uc988\uba54\uc774\ub2c8\uc544" },
  \u5317\u99ac\u7d2f\u74b0\u7901: { ja: "\u5317\u30de\u30fc\u30ec\u74b0\u7901", ko: "\ubd81\ub9d0\ub808 \ud658\ucd08" },
  \u590f\u5a01\u5937: { ja: "\u30cf\u30ef\u30a4", ko: "\ud558\uc640\uc774" },
  \u99ac\u723e\u5730\u592b: { ja: "\u30e2\u30eb\u30c7\u30a3\u30d6", ko: "\ubab0\ub514\ube0c" },
};

/**
 * Exact ja / ko / en display name → canonical label (「교토」→「京都」). Only for the
 * combination-choice destination switch (global-planning-context); other routing keeps
 * CITY_LOCALE_ALIASES only.
 */
export function canonicalFromDisplayName(name: string): string | undefined {
  const raw = name.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  for (const [canonical, names] of Object.entries(CITY_DISPLAY_NAMES)) {
    if (names.ja === raw || names.ko === raw || names.en?.toLowerCase() === lower) return canonical;
  }
  return undefined;
}

/** User's own spelling of a known alias for `canonical`, found anywhere in `userText`. */
function userSurfaceForCanonical(canonical: string, userText: string | undefined): string | undefined {
  const text = userText?.trim();
  if (!text) return undefined;
  const extracted = extractKnownAliasDestination(text);
  if (extracted?.canonical === canonical) return extracted.surface;
  const keys = Object.entries(CITY_LOCALE_ALIASES)
    .filter(([, value]) => value === canonical)
    .map(([key]) => key)
    .sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (/^[a-z0-9]/i.test(key)) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = text.match(new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "i"));
      if (found) return found[0];
    } else if (text.includes(key)) {
      return key;
    }
  }
  return undefined;
}

/** Latin alias for `canonical`, title-cased ("da nang" → "Da Nang"). */
function latinAliasForCanonical(canonical: string): string | undefined {
  const alias = Object.entries(CITY_LOCALE_ALIASES).find(
    ([key, value]) => value === canonical && /^[a-z]/.test(key),
  )?.[0];
  return alias?.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Preserve a known Latin alias in non-zh display. Routing stays canonical. */
export function displayDestinationForCopy(
  canonical: string,
  userText: string | undefined,
  locale: "zh-TW" | "en" | "ja" | "ko",
): string {
  if (locale === "zh-TW") return canonical;
  const country = localizedCountryName(canonical, locale);
  if (country) return country;
  if (locale !== "en") {
    const native = CITY_DISPLAY_NAMES[canonical]?.[locale];
    if (native) return native;
  }
  const aliases = Object.entries(CITY_LOCALE_ALIASES).filter(([,value]) => value === canonical);
  const script = locale === 'ja' ? /[\u3040-\u30ff]/ : locale === 'ko' ? /[\uac00-\ud7a3]/ : /^[a-z]/;
  const alias = aliases.find(([key]) => script.test(key))?.[0];
  if (alias) return locale === 'en' ? alias.replace(/\b\w/g, c => c.toUpperCase()) : alias;
  // Display-only English name table (e.g. 嘉義 → Chiayi); never guessed from user text.
  const english = EN_CITY_NAMES[canonical] ?? CITY_DISPLAY_NAMES[canonical]?.en;
  if (locale === "en" && english) return english;
  const surface = userSurfaceForCanonical(canonical, userText);
  if (surface) return surface;
  if (locale === "ko") return latinAliasForCanonical(canonical) ?? english ?? canonical;
  if (locale === "ja") return toJaShinjitai(canonical);
  return canonical;
}

export { englishNameInSentence } from "@/lib/i18n/en-place-articles";

/** Traditional-only kanji → Japanese shinjitai, for kanji labels without a ja display row. */
const JA_SHINJITAI: Record<string, string> = {
  // Place-name characters only (Taiwan / Korea / Japan labels); foreign transliterations keep
  // their existing fallback.
  臺: "台", 濟: "済", 廣: "広", 澤: "沢", 兒: "児", 戶: "戸", 繩: "縄", 橫: "横", 濱: "浜",
  綠: "緑", 灣: "湾", 縣: "県",
};

function toJaShinjitai(label: string): string {
  return [...label].map((ch) => JA_SHINJITAI[ch] ?? ch).join("");
}

/**
 * Korean particle after `word`: final consonant (받침) when (code - 0xAC00) % 28 != 0.
 * Non-Hangul endings use the vowel form (를 / 가 / 는 / 와).
 */
export function koParticle(word: string, withBatchim: string, withoutBatchim: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  const final = hangul ? (code - 0xac00) % 28 : 0;
  // Directional 으로/로: a final ㄹ (index 8) takes 로 like a vowel ending (서울로, 부산으로).
  if (withBatchim === "으로" && final === 8) return withoutBatchim;
  return final !== 0 ? withBatchim : withoutBatchim;
}

const KO_PARTICLE_PAIRS: Record<string, [string, string]> = {
  을: ["을", "를"], 를: ["을", "를"],
  이: ["이", "가"], 가: ["이", "가"],
  은: ["은", "는"], 는: ["은", "는"],
  과: ["과", "와"], 와: ["과", "와"],
  으로: ["으로", "로"], 로: ["으로", "로"],
};

/**
 * Fix the particle directly after each interpolated `word` in ko copy
 * ("시드니을 중심으로" → "시드니를 중심으로"). Other locales are returned unchanged.
 */
export function applyKoParticles(text: string, words: Array<string | undefined>, locale?: string): string {
  if (locale !== "ko") return text;
  let out = text;
  for (const word of new Set(words.map((w) => w?.trim()).filter((w): w is string => Boolean(w)))) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`${escaped}(으로|을|를|이|가|은|는|과|와|로)(?=[\\s.,!?)]|$)`, "g"),
      (_match, particle: string) => {
        const [withBatchim, withoutBatchim] = KO_PARTICLE_PAIRS[particle]!;
        return `${word}${koParticle(word, withBatchim, withoutBatchim)}`;
      },
    );
  }
  return out;
}

export function cityLocaleEvidenceAliases(label: string): string[] {
  const canonical = applyCityLocaleAlias(label);
  const aliases = Object.entries(CITY_LOCALE_ALIASES)
    .filter(([, zh]) => zh === canonical)
    .map(([alias]) => alias);
  return [...new Set([canonical, ...aliases])];
}
