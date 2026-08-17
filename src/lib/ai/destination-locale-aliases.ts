/**
 * Locale / alias normalization for travel destinations.
 * Maps English, kana, and common variants → canonical zh labels used by the app.
 * Generic mechanism — not city-specific business logic.
 */

/** Kana / romaji / English variants → canonical destination label */
const CITY_LOCALE_ALIASES: Record<string, string> = {
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
  return raw;
}

export function cityLocaleEvidenceAliases(label: string): string[] {
  const canonical = applyCityLocaleAlias(label);
  const aliases = Object.entries(CITY_LOCALE_ALIASES)
    .filter(([, zh]) => zh === canonical)
    .map(([alias]) => alias);
  return [...new Set([canonical, ...aliases])];
}
