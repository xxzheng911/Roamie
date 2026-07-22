/**
 * Destination Alias Resolver — normalization only.
 *
 * Maps locale / spelling variants → canonical display name + English search name.
 * Does NOT bind fixed coordinates. Geocode / Places / cache own location resolution.
 */
import type { DestinationEntityType } from "@/lib/ai/destination-entity";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  countryCodeForLabel,
  normalizeCountryReference,
} from "@/lib/ai/destination-country-normalize";

function countryCodeForHint(country?: string | null): string | undefined {
  if (!country) return undefined;
  return normalizeCountryReference(country).countryCode ?? countryCodeForLabel(country);
}

export type DestinationAliasRecord = {
  /** Canonical internal / display label (usually zh-TW). */
  canonicalName: string;
  /** Primary romanized / English name for geocode & Places search. */
  searchName: string;
  /** All known aliases including canonical + English variants. */
  aliases: string[];
  /** Extra geocode query stems (Island / Province / …) without country suffix. */
  searchVariants?: string[];
  entityType?: DestinationEntityType;
  /** Parent country label (zh) when known. */
  countryHint?: string;
  /** English admin area (e.g. Chon Buri) for geocode disambiguation. */
  administrativeArea?: string;
  /** Localized admin area (e.g. 春武里府). */
  administrativeAreaLocal?: string;
};

export type ResolvedDestinationAlias = {
  displayName: string;
  normalizedName: string;
  searchName: string;
  aliases: string[];
  searchVariants: string[];
  entityType?: DestinationEntityType;
  countryHint?: string;
  countryCode?: string;
  administrativeArea?: string;
  administrativeAreaLocal?: string;
};

/**
 * Travel-destination alias table — data only.
 * Prefer adding aliases here over inventing per-city coordinate hubs.
 */
const DESTINATION_ALIAS_RECORDS: DestinationAliasRecord[] = [
  // Thailand
  {
    canonicalName: "普吉島",
    searchName: "Phuket",
    aliases: ["普吉島", "普吉", "普吉市", "Phuket", "Phuket Island", "Phuket Province", "ภูเก็ต"],
    searchVariants: ["Phuket Island", "Phuket Province", "Phuket, Phuket"],
    entityType: "island",
    countryHint: "泰國",
  },
  {
    canonicalName: "蘇梅島",
    searchName: "Koh Samui",
    aliases: ["蘇梅島", "蘇梅", "苏梅岛", "苏梅", "Koh Samui", "Ko Samui", "Samui", "เกาะสมุย"],
    searchVariants: [
      "Ko Samui",
      "Samui Island",
      "Koh Samui Island",
      "Koh Samui, Surat Thani",
      "Ko Samui, Surat Thani",
    ],
    entityType: "island",
    countryHint: "泰國",
  },
  {
    canonicalName: "曼谷",
    searchName: "Bangkok",
    aliases: ["曼谷", "Bangkok", "Bangkok City", "กรุงเทพ"],
    entityType: "city",
    countryHint: "泰國",
  },
  {
    canonicalName: "清邁",
    searchName: "Chiang Mai",
    aliases: ["清邁", "清迈", "Chiang Mai", "Chiangmai"],
    entityType: "city",
    countryHint: "泰國",
  },
  {
    canonicalName: "芭達雅",
    searchName: "Pattaya",
    aliases: [
      "芭達雅",
      "芭堤雅",
      "巴達雅",
      "帕塔雅",
      "Pattaya",
      "Pattaya City",
      "พัทยา",
    ],
    searchVariants: [
      "Pattaya, Thailand",
      "Pattaya, Chon Buri, Thailand",
      "Pattaya City, Chon Buri, Thailand",
      "Pattaya City, Thailand",
      "芭達雅，泰國",
      "芭達雅，春武里府，泰國",
      "芭達雅, 泰國",
      "芭堤雅, 泰國",
    ],
    entityType: "resort_area",
    countryHint: "泰國",
    administrativeArea: "Chon Buri",
    administrativeAreaLocal: "春武里府",
  },
  // Greater China
  {
    canonicalName: "深圳",
    searchName: "Shenzhen",
    aliases: [
      "深圳",
      "深圳市",
      "Shenzhen",
      "Shenzhen City",
      "深圳，中国",
      "深圳，中國",
    ],
    searchVariants: [
      "Shenzhen, China",
      "Shenzhen, Guangdong, China",
      "Shenzhen City, Guangdong, China",
      "深圳，中國",
      "深圳，廣東，中國",
      "深圳市，廣東省，中國",
    ],
    entityType: "city",
    countryHint: "中國",
    administrativeArea: "Guangdong",
    administrativeAreaLocal: "廣東",
  },
  {
    canonicalName: "廣州",
    searchName: "Guangzhou",
    aliases: ["廣州", "广州市", "廣州市", "Guangzhou", "Guangzhou City"],
    entityType: "city",
    countryHint: "中國",
    administrativeArea: "Guangdong",
    administrativeAreaLocal: "廣東",
  },
  {
    canonicalName: "上海",
    searchName: "Shanghai",
    aliases: ["上海", "上海市", "Shanghai", "Shanghai City"],
    entityType: "city",
    countryHint: "中國",
  },
  {
    canonicalName: "北京",
    searchName: "Beijing",
    aliases: ["北京", "北京市", "Beijing", "Beijing City", "Peking"],
    entityType: "city",
    countryHint: "中國",
  },
  {
    canonicalName: "甲米",
    searchName: "Krabi",
    aliases: ["甲米", "喀比", "Krabi"],
    entityType: "region",
    countryHint: "泰國",
  },
  {
    canonicalName: "華欣",
    searchName: "Hua Hin",
    aliases: ["華欣", "华欣", "Hua Hin"],
    entityType: "resort_area",
    countryHint: "泰國",
  },
  // Indonesia
  {
    canonicalName: "峇里島",
    searchName: "Bali",
    aliases: ["峇里島", "巴厘岛", "巴里島", "Bali", "Bali Island", "Pulau Bali"],
    searchVariants: ["Bali Island", "Bali Province"],
    entityType: "island",
    countryHint: "印尼",
  },
  {
    canonicalName: "龍目島",
    searchName: "Lombok",
    aliases: ["龍目島", "龙目岛", "Lombok"],
    entityType: "island",
    countryHint: "印尼",
  },
  {
    canonicalName: "雅加達",
    searchName: "Jakarta",
    aliases: ["雅加達", "雅加达", "Jakarta"],
    entityType: "city",
    countryHint: "印尼",
  },
  {
    canonicalName: "日惹",
    searchName: "Yogyakarta",
    aliases: ["日惹", "Yogyakarta", "Jogja"],
    entityType: "city",
    countryHint: "印尼",
  },
  {
    canonicalName: "泗水",
    searchName: "Surabaya",
    aliases: ["泗水", "Surabaya"],
    entityType: "city",
    countryHint: "印尼",
  },
  // Japan
  {
    canonicalName: "北海道",
    searchName: "Hokkaido",
    aliases: ["北海道", "Hokkaido", "Hokkaidō"],
    searchVariants: ["Hokkaido Prefecture"],
    entityType: "region",
    countryHint: "日本",
  },
  {
    canonicalName: "沖繩",
    searchName: "Okinawa",
    aliases: ["沖繩", "冲绳", "Okinawa", "Okinawa Island", "Okinawa Prefecture", "おきなわ"],
    searchVariants: ["Okinawa Island", "Okinawa Prefecture"],
    entityType: "island",
    countryHint: "日本",
  },
  {
    canonicalName: "沖繩本島",
    searchName: "Okinawa Island",
    aliases: ["沖繩本島", "冲绳本岛", "Okinawa Island", "Okinawa Main Island"],
    entityType: "island",
    countryHint: "日本",
  },
  {
    canonicalName: "石垣島",
    searchName: "Ishigaki",
    aliases: ["石垣島", "石垣岛", "Ishigaki", "Ishigaki Island"],
    entityType: "island",
    countryHint: "日本",
  },
  {
    canonicalName: "宮古島",
    searchName: "Miyakojima",
    aliases: ["宮古島", "宫古岛", "Miyakojima", "Miyako Island"],
    entityType: "island",
    countryHint: "日本",
  },
  {
    canonicalName: "九州",
    searchName: "Kyushu",
    aliases: ["九州", "Kyushu", "Kyūshū"],
    entityType: "region",
    countryHint: "日本",
  },
  {
    canonicalName: "名古屋",
    searchName: "Nagoya",
    aliases: ["名古屋", "名古屋市", "Nagoya", "Nagoya City", "なごや", "ナゴヤ"],
    entityType: "city",
    countryHint: "日本",
    administrativeArea: "Aichi",
    administrativeAreaLocal: "愛知県",
  },
  {
    canonicalName: "戈壁",
    searchName: "Gobi",
    aliases: ["戈壁", "戈壁沙漠", "Gobi", "Gobi Desert"],
    searchVariants: ["Gobi Desert", "Gobi region"],
    entityType: "region",
    countryHint: "蒙古",
  },
  {
    canonicalName: "開羅",
    searchName: "Cairo",
    aliases: ["開羅", "开罗", "Cairo", "Al Qahirah", "القاهرة"],
    searchVariants: ["Cairo, Egypt", "Cairo, EG", "開羅, 埃及", "القاهرة, مصر"],
    entityType: "city",
    countryHint: "埃及",
  },
  {
    canonicalName: "盧克索",
    searchName: "Luxor",
    aliases: ["盧克索", "卢克索", "Luxor"],
    entityType: "city",
    countryHint: "埃及",
  },
  {
    canonicalName: "紅海",
    searchName: "Red Sea",
    aliases: ["紅海", "红海", "Red Sea", "Hurghada"],
    searchVariants: ["Red Sea, Egypt", "Hurghada, Egypt"],
    entityType: "region",
    countryHint: "埃及",
  },
  {
    canonicalName: "烏蘭巴托",
    searchName: "Ulaanbaatar",
    aliases: ["烏蘭巴托", "乌兰巴托", "Ulaanbaatar", "Ulan Bator"],
    entityType: "city",
    countryHint: "蒙古",
  },
  {
    canonicalName: "特勒吉",
    searchName: "Terelj",
    aliases: ["特勒吉", "Terelj", "Gorkhi-Terelj"],
    entityType: "region",
    countryHint: "蒙古",
  },
  {
    canonicalName: "東京",
    searchName: "Tokyo",
    aliases: ["東京", "东京", "Tokyo", "Tokyo City", "とうきょう", "トウキョウ"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "大阪",
    searchName: "Osaka",
    aliases: ["大阪", "Osaka", "Osaka City", "おおさか", "オオサカ"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "京都",
    searchName: "Kyoto",
    aliases: ["京都", "Kyoto", "Kyoto City", "きょうと", "キョウト"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "札幌",
    searchName: "Sapporo",
    aliases: ["札幌", "Sapporo", "さっぽろ"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "福岡",
    searchName: "Fukuoka",
    aliases: ["福岡", "福冈", "福岡市", "Fukuoka", "Fukuoka City", "ふくおか"],
    searchVariants: [
      "福岡市, 福岡県, 日本",
      "Fukuoka City, Fukuoka Prefecture, Japan",
      "Fukuoka City, Japan",
    ],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "熊本",
    searchName: "Kumamoto",
    aliases: [
      "熊本",
      "熊本市",
      "Kumamoto",
      "Kumamoto City",
      "くまもと",
      "熊本県熊本市",
      "熊本縣熊本市",
    ],
    searchVariants: [
      "Kumamoto, Kumamoto Prefecture, Japan",
      "Kumamoto City, Japan",
      "熊本市, 熊本県, 日本",
      "熊本, 日本",
      "Kumamoto, Japan",
    ],
    entityType: "city",
    countryHint: "日本",
    administrativeArea: "Kumamoto Prefecture",
    administrativeAreaLocal: "熊本県",
  },
  {
    canonicalName: "廣島",
    searchName: "Hiroshima",
    aliases: ["廣島", "広島", "广岛", "廣島市", "Hiroshima", "Hiroshima City"],
    searchVariants: [
      "広島市, 広島県, 日本",
      "廣島市, 廣島縣, 日本",
      "Hiroshima City, Hiroshima Prefecture, Japan",
      "Hiroshima, Japan",
    ],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "長崎",
    searchName: "Nagasaki",
    aliases: ["長崎", "長崎市", "Nagasaki", "Nagasaki City"],
    searchVariants: [
      "長崎市, 長崎県, 日本",
      "Nagasaki City, Nagasaki Prefecture, Japan",
      "Nagasaki, Japan",
    ],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "鹿兒島",
    searchName: "Kagoshima",
    aliases: ["鹿兒島", "鹿児島", "鹿儿岛", "鹿兒島市", "Kagoshima", "Kagoshima City"],
    searchVariants: [
      "鹿児島市, 鹿児島県, 日本",
      "Kagoshima City, Kagoshima Prefecture, Japan",
      "Kagoshima, Japan",
    ],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "仙台",
    searchName: "Sendai",
    aliases: ["仙台", "仙台市", "Sendai", "Sendai City"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "金澤",
    searchName: "Kanazawa",
    aliases: ["金澤", "金沢", "金泽", "Kanazawa"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "高山",
    searchName: "Takayama",
    aliases: ["高山", "飛驒高山", "Takayama", "Hida Takayama"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "松本",
    searchName: "Matsumoto",
    aliases: ["松本", "松本市", "Matsumoto"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "神戶",
    searchName: "Kobe",
    aliases: ["神戶", "神戸", "神户", "Kobe", "Kobe City"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "奈良",
    searchName: "Nara",
    aliases: ["奈良", "奈良市", "Nara", "Nara City"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "函館",
    searchName: "Hakodate",
    aliases: ["函館", "函馆", "Hakodate"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "小樽",
    searchName: "Otaru",
    aliases: ["小樽", "Otaru"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "箱根",
    searchName: "Hakone",
    aliases: ["箱根", "Hakone"],
    entityType: "resort_area",
    countryHint: "日本",
  },
  {
    canonicalName: "輕井澤",
    searchName: "Karuizawa",
    aliases: ["輕井澤", "轻井泽", "Karuizawa"],
    entityType: "city",
    countryHint: "日本",
  },
  {
    canonicalName: "白川鄉",
    searchName: "Shirakawa-go",
    aliases: ["白川鄉", "白川郷", "白川乡", "Shirakawa-go", "Shirakawa go"],
    entityType: "resort_area",
    countryHint: "日本",
  },
  // Korea
  {
    canonicalName: "濟州",
    searchName: "Jeju",
    aliases: ["濟州", "濟州島", "济州", "济州岛", "Jeju", "Jeju Island", "Jeju-do", "제주", "제주도"],
    searchVariants: [
      "Jeju Island",
      "Jeju-do",
      "Jeju-si",
      "Jeju Special Self-Governing Province",
    ],
    entityType: "island",
    countryHint: "韓國",
  },
  {
    canonicalName: "首爾",
    searchName: "Seoul",
    aliases: ["首爾", "首尔", "Seoul", "Seoul City", "ソウル"],
    entityType: "city",
    countryHint: "韓國",
  },
  {
    canonicalName: "釜山",
    searchName: "Busan",
    aliases: ["釜山", "Busan", "Pusan"],
    entityType: "city",
    countryHint: "韓國",
  },
  {
    canonicalName: "仁川",
    searchName: "Incheon",
    aliases: ["仁川", "Incheon"],
    entityType: "city",
    countryHint: "韓國",
  },
  {
    canonicalName: "大邱",
    searchName: "Daegu",
    aliases: ["大邱", "Daegu"],
    entityType: "city",
    countryHint: "韓國",
  },
  // Philippines
  {
    canonicalName: "宿霧",
    searchName: "Cebu",
    aliases: ["宿霧", "宿务", "Cebu", "Cebu City", "宿霧島", "Cebu Island"],
    searchVariants: ["Cebu Island", "Cebu Province"],
    entityType: "region",
    countryHint: "菲律賓",
  },
  {
    canonicalName: "長灘島",
    searchName: "Boracay",
    aliases: ["長灘島", "长滩岛", "長灘", "Boracay", "Boracay Island"],
    searchVariants: ["Boracay Island"],
    entityType: "island",
    countryHint: "菲律賓",
  },
  {
    canonicalName: "巴拉望",
    searchName: "Palawan",
    aliases: ["巴拉望", "Palawan"],
    entityType: "region",
    countryHint: "菲律賓",
  },
  {
    canonicalName: "馬尼拉",
    searchName: "Manila",
    aliases: ["馬尼拉", "马尼拉", "Manila"],
    entityType: "city",
    countryHint: "菲律賓",
  },
  {
    canonicalName: "薄荷島",
    searchName: "Bohol",
    aliases: ["薄荷島", "薄荷岛", "Bohol"],
    entityType: "island",
    countryHint: "菲律賓",
  },
  {
    canonicalName: "愛妮島",
    searchName: "El Nido",
    aliases: ["愛妮島", "爱妮岛", "El Nido"],
    entityType: "resort_area",
    countryHint: "菲律賓",
  },
  // Vietnam
  {
    canonicalName: "河內",
    searchName: "Hanoi",
    aliases: ["河內", "河内", "Hanoi"],
    entityType: "city",
    countryHint: "越南",
  },
  {
    canonicalName: "胡志明市",
    searchName: "Ho Chi Minh City",
    aliases: ["胡志明市", "胡志明", "Ho Chi Minh City", "Saigon", "西貢"],
    entityType: "city",
    countryHint: "越南",
  },
  {
    canonicalName: "峴港",
    searchName: "Da Nang",
    aliases: ["峴港", "岘港", "Da Nang", "Danang"],
    entityType: "city",
    countryHint: "越南",
  },
  {
    canonicalName: "會安",
    searchName: "Hoi An",
    aliases: ["會安", "会安", "Hoi An"],
    entityType: "city",
    countryHint: "越南",
  },
  {
    canonicalName: "芽莊",
    searchName: "Nha Trang",
    aliases: ["芽莊", "芽庄", "Nha Trang"],
    entityType: "city",
    countryHint: "越南",
  },
  {
    canonicalName: "富國島",
    searchName: "Phu Quoc",
    aliases: ["富國島", "富国岛", "Phu Quoc", "Phú Quốc"],
    searchVariants: ["Phu Quoc Island"],
    entityType: "island",
    countryHint: "越南",
  },
  // Malaysia
  {
    canonicalName: "吉隆坡",
    searchName: "Kuala Lumpur",
    aliases: ["吉隆坡", "Kuala Lumpur", "KL"],
    entityType: "city",
    countryHint: "馬來西亞",
  },
  {
    canonicalName: "檳城",
    searchName: "Penang",
    aliases: ["檳城", "槟城", "Penang", "檳城島", "Penang Island"],
    searchVariants: ["Penang Island"],
    entityType: "island",
    countryHint: "馬來西亞",
  },
  {
    canonicalName: "蘭卡威",
    searchName: "Langkawi",
    aliases: ["蘭卡威", "兰卡威", "Langkawi"],
    searchVariants: ["Langkawi Island"],
    entityType: "island",
    countryHint: "馬來西亞",
  },
  {
    canonicalName: "沙巴",
    searchName: "Sabah",
    aliases: ["沙巴", "Sabah"],
    entityType: "region",
    countryHint: "馬來西亞",
  },
  {
    canonicalName: "亞庇",
    searchName: "Kota Kinabalu",
    aliases: ["亞庇", "亚庇", "Kota Kinabalu", "KK"],
    entityType: "city",
    countryHint: "馬來西亞",
  },
  // Singapore
  {
    canonicalName: "新加坡",
    searchName: "Singapore",
    aliases: ["新加坡", "Singapore"],
    entityType: "city",
    countryHint: "新加坡",
  },
  {
    canonicalName: "聖淘沙",
    searchName: "Sentosa",
    aliases: ["聖淘沙", "圣淘沙", "Sentosa"],
    entityType: "island",
    countryHint: "新加坡",
  },
  // Greece / Spain / Australia / Maldives (acceptance cases)
  {
    canonicalName: "聖托里尼",
    searchName: "Santorini",
    aliases: ["聖托里尼", "圣托里尼", "Santorini", "Thira"],
    searchVariants: ["Santorini Island"],
    entityType: "island",
    countryHint: "希臘",
  },
  {
    canonicalName: "馬略卡島",
    searchName: "Mallorca",
    aliases: ["馬略卡島", "马略卡岛", "Mallorca", "Majorca"],
    searchVariants: ["Mallorca Island"],
    entityType: "island",
    countryHint: "西班牙",
  },
  {
    canonicalName: "塔斯馬尼亞",
    searchName: "Tasmania",
    aliases: ["塔斯馬尼亞", "塔斯马尼亚", "Tasmania"],
    searchVariants: ["Tasmania Island", "Tasmania, Australia", "State of Tasmania, Australia"],
    entityType: "island",
    countryHint: "澳洲",
  },
  // Italy / France / Spain / global cities
  {
    canonicalName: "佛羅倫斯",
    searchName: "Florence",
    aliases: ["佛羅倫斯", "佛罗伦萨", "翡冷翠", "Florence", "Firenze"],
    searchVariants: ["Firenze, Italy", "Florence, Italy", "Firenze, Toscana, Italy"],
    entityType: "city",
    countryHint: "義大利",
  },
  {
    canonicalName: "羅馬",
    searchName: "Rome",
    aliases: ["羅馬", "罗马", "Rome", "Roma"],
    entityType: "city",
    countryHint: "義大利",
  },
  {
    canonicalName: "米蘭",
    searchName: "Milan",
    aliases: ["米蘭", "米兰", "Milan", "Milano"],
    entityType: "city",
    countryHint: "義大利",
  },
  {
    canonicalName: "威尼斯",
    searchName: "Venice",
    aliases: ["威尼斯", "Venice", "Venezia"],
    entityType: "city",
    countryHint: "義大利",
  },
  {
    canonicalName: "拿坡里",
    searchName: "Naples",
    aliases: ["拿坡里", "那不勒斯", "Naples", "Napoli"],
    entityType: "city",
    countryHint: "義大利",
  },
  {
    canonicalName: "西西里島",
    searchName: "Sicily",
    aliases: ["西西里島", "西西里", "Sicily", "Sicilia"],
    searchVariants: ["Sicily Island", "Sicilia, Italy"],
    entityType: "island",
    countryHint: "義大利",
  },
  {
    canonicalName: "巴黎",
    searchName: "Paris",
    aliases: ["巴黎", "Paris"],
    entityType: "city",
    countryHint: "法國",
  },
  {
    canonicalName: "里昂",
    searchName: "Lyon",
    aliases: ["里昂", "Lyon"],
    entityType: "city",
    countryHint: "法國",
  },
  {
    canonicalName: "尼斯",
    searchName: "Nice",
    aliases: ["尼斯", "Nice"],
    entityType: "city",
    countryHint: "法國",
  },
  {
    canonicalName: "亞維儂",
    searchName: "Avignon",
    aliases: ["亞維儂", "阿维尼翁", "Avignon"],
    entityType: "city",
    countryHint: "法國",
  },
  {
    canonicalName: "史特拉斯堡",
    searchName: "Strasbourg",
    aliases: ["史特拉斯堡", "斯特拉斯堡", "Strasbourg"],
    entityType: "city",
    countryHint: "法國",
  },
  {
    canonicalName: "馬德里",
    searchName: "Madrid",
    aliases: ["馬德里", "马德里", "Madrid"],
    entityType: "city",
    countryHint: "西班牙",
  },
  {
    canonicalName: "巴塞隆納",
    searchName: "Barcelona",
    aliases: ["巴塞隆納", "巴塞罗那", "Barcelona"],
    entityType: "city",
    countryHint: "西班牙",
  },
  {
    canonicalName: "雪梨",
    searchName: "Sydney",
    aliases: ["雪梨", "悉尼", "Sydney"],
    entityType: "city",
    countryHint: "澳洲",
  },
  {
    canonicalName: "墨爾本",
    searchName: "Melbourne",
    aliases: ["墨爾本", "墨尔本", "Melbourne"],
    entityType: "city",
    countryHint: "澳洲",
  },
  {
    canonicalName: "紐約",
    searchName: "New York",
    aliases: ["紐約", "纽约", "New York", "New York City", "NYC"],
    entityType: "city",
    countryHint: "美國",
  },
  {
    canonicalName: "舊金山",
    searchName: "San Francisco",
    aliases: ["舊金山", "旧金山", "San Francisco", "SF"],
    entityType: "city",
    countryHint: "美國",
  },
  {
    canonicalName: "洛杉磯",
    searchName: "Los Angeles",
    aliases: ["洛杉磯", "洛杉矶", "Los Angeles", "LA"],
    entityType: "city",
    countryHint: "美國",
  },
  {
    canonicalName: "慶州",
    searchName: "Gyeongju",
    aliases: ["慶州", "庆州", "Gyeongju"],
    entityType: "city",
    countryHint: "韓國",
  },
  {
    canonicalName: "江陵",
    searchName: "Gangneung",
    aliases: ["江陵", "Gangneung"],
    entityType: "city",
    countryHint: "韓國",
  },
  // Taiwan tourism areas
  {
    canonicalName: "阿里山",
    searchName: "Alishan",
    aliases: ["阿里山", "Alishan"],
    searchVariants: [
      "阿里山國家森林遊樂區, 嘉義縣, 台灣",
      "Alishan National Forest Recreation Area, Taiwan",
      "Alishan, Chiayi County, Taiwan",
    ],
    entityType: "resort_area",
    countryHint: "台灣",
  },
  {
    canonicalName: "日月潭",
    searchName: "Sun Moon Lake",
    aliases: ["日月潭", "Sun Moon Lake"],
    entityType: "resort_area",
    countryHint: "台灣",
  },
  {
    canonicalName: "墾丁",
    searchName: "Kenting",
    aliases: ["墾丁", "垦丁", "Kenting"],
    entityType: "resort_area",
    countryHint: "台灣",
  },
  {
    canonicalName: "北馬累環礁",
    searchName: "North Male Atoll",
    aliases: ["北馬累環礁", "北马累环礁", "North Malé Atoll", "North Male Atoll"],
    searchVariants: ["North Malé Atoll", "Kaafu Atoll"],
    entityType: "archipelago",
    countryHint: "馬爾地夫",
  },
  {
    canonicalName: "南馬累環礁",
    searchName: "South Male Atoll",
    aliases: ["南馬累環礁", "南马累环礁", "South Malé Atoll", "South Male Atoll"],
    entityType: "archipelago",
    countryHint: "馬爾地夫",
  },
  {
    canonicalName: "馬列",
    searchName: "Male",
    aliases: ["馬列", "马列", "Malé", "Male"],
    entityType: "city",
    countryHint: "馬爾地夫",
  },
  // Maldives / Hawaii / others
  {
    canonicalName: "馬爾地夫",
    searchName: "Maldives",
    aliases: ["馬爾地夫", "马尔代夫", "馬爾代夫", "Maldives", "The Maldives"],
    entityType: "country",
    countryHint: "馬爾地夫",
  },
  {
    canonicalName: "夏威夷",
    searchName: "Hawaii",
    aliases: ["夏威夷", "Hawaii", "Hawaiʻi", "Hawaiian Islands"],
    searchVariants: ["Hawaii Island", "State of Hawaii"],
    entityType: "region",
    countryHint: "美國",
  },
  // Taiwan counties often selected as destinations
  {
    canonicalName: "屏東",
    searchName: "Pingtung",
    aliases: ["屏東", "屏东", "Pingtung"],
    entityType: "province",
    countryHint: "台灣",
  },
  {
    canonicalName: "宜蘭",
    searchName: "Yilan",
    aliases: ["宜蘭", "宜兰", "Yilan"],
    entityType: "province",
    countryHint: "台灣",
  },
  {
    canonicalName: "花蓮",
    searchName: "Hualien",
    aliases: ["花蓮", "花莲", "Hualien"],
    entityType: "province",
    countryHint: "台灣",
  },
];

let aliasIndex: Map<string, DestinationAliasRecord> | null = null;

function indexKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Strip trailing ", Japan" / "，日本" so "熊本，日本" still hits the city alias. */
function stripTrailingCountryQualifier(raw: string): string {
  const stripped = raw
    .replace(
      /\s*[,，、/|]\s*(日本|Japan|韓國|韩国|Korea|South Korea|泰國|泰国|Thailand|台灣|台湾|Taiwan|中國|中国|China|美國|美国|USA|United States|澳洲|Australia|新加坡|Singapore|法國|法国|France|英國|英国|United Kingdom|UK|印尼|Indonesia|菲律賓|菲律宾|Philippines|越南|Vietnam|馬來西亞|马来西亚|Malaysia)\s*$/iu,
      "",
    )
    .trim();
  return stripped || raw.trim();
}

function getAliasIndex(): Map<string, DestinationAliasRecord> {
  if (aliasIndex) return aliasIndex;
  aliasIndex = new Map();
  for (const record of DESTINATION_ALIAS_RECORDS) {
    const keys = new Set<string>([
      indexKey(record.canonicalName),
      indexKey(record.searchName),
      ...record.aliases.map(indexKey),
      ...(record.searchVariants ?? []).map(indexKey),
    ]);
    for (const key of keys) {
      if (!key) continue;
      if (!aliasIndex.has(key)) aliasIndex.set(key, record);
    }
  }
  return aliasIndex;
}

/**
 * Resolve raw user / option text to canonical + search names.
 * Always returns a result (heuristic fallback when not in the alias table).
 */
export function resolveDestinationAlias(
  raw: string,
  opts?: { countryHint?: string | null; displayName?: string | null },
): ResolvedDestinationAlias {
  const trimmed = stripTrailingCountryQualifier((raw ?? "").trim());
  const normalized = normalizeDestinationLabel(trimmed);
  const displayName = (opts?.displayName?.trim() || trimmed || normalized) || normalized;
  const indexed = getAliasIndex();
  const hit =
    indexed.get(indexKey(trimmed)) ??
    indexed.get(indexKey(normalized)) ??
    (normalized.endsWith("島") || normalized.endsWith("岛")
      ? indexed.get(indexKey(normalized.replace(/[島岛]$/, "")))
      : undefined);

  if (hit) {
    const countryHint = opts?.countryHint?.trim() || hit.countryHint;
    return {
      displayName: displayName || hit.canonicalName,
      normalizedName: hit.canonicalName,
      searchName: hit.searchName,
      aliases: [...new Set(hit.aliases)],
      searchVariants: [...(hit.searchVariants ?? [])],
      entityType: hit.entityType,
      countryHint,
      countryCode: countryCodeForHint(countryHint),
      administrativeArea: hit.administrativeArea,
      administrativeAreaLocal: hit.administrativeAreaLocal,
    };
  }

  // Heuristic: keep normalized label; use Latin as searchName when already Latin.
  const looksLatin = /^[A-Za-z0-9\s.'’-]+$/.test(normalized);
  const searchName = looksLatin
    ? normalized.replace(/\s+island$/i, "").replace(/\s+province$/i, "").trim() || normalized
    : normalized;
  const countryHint = opts?.countryHint?.trim() || undefined;
  return {
    displayName: displayName || normalized,
    normalizedName: normalized,
    searchName,
    aliases: [...new Set([normalized, trimmed, searchName].filter(Boolean))],
    searchVariants: [],
    countryHint,
    countryCode: countryCodeForHint(countryHint),
  };
}

/** English / romanized search name for geocode — never invents coordinates. */
export function resolveDestinationSearchName(
  raw: string,
  countryHint?: string | null,
): string {
  return resolveDestinationAlias(raw, { countryHint }).searchName;
}

/** All aliases for a destination (for option matching). */
export function listDestinationAliases(
  raw: string,
  countryHint?: string | null,
): string[] {
  return resolveDestinationAlias(raw, { countryHint }).aliases;
}

/**
 * Build ordered geocode query strings with parent-country context.
 * Example for 熊本 + 日本:
 *   熊本市, 熊本県, 日本 → 熊本, 日本 → Kumamoto City, … → Kumamoto, Japan
 *
 * Island / Province suffixes are only added for island / region / province entities.
 */
export function buildAliasGeocodeQueries(params: {
  destination: string;
  countryHint?: string | null;
  countryCode?: string | null;
  countryEn?: string | null;
}): string[] {
  const alias = resolveDestinationAlias(params.destination, {
    countryHint: params.countryHint,
  });
  const countryZh = alias.countryHint ?? params.countryHint?.trim() ?? "";
  const countryEn =
    params.countryEn?.trim() ||
    (countryZh
      ? ({
          泰國: "Thailand",
          日本: "Japan",
          韓國: "South Korea",
          韩国: "South Korea",
          印尼: "Indonesia",
          印度尼西亞: "Indonesia",
          菲律賓: "Philippines",
          菲律宾: "Philippines",
          台灣: "Taiwan",
          台湾: "Taiwan",
          中國: "China",
          中国: "China",
          香港: "Hong Kong",
          澳門: "Macau",
          澳门: "Macau",
          美國: "United States",
          美国: "United States",
          馬爾地夫: "Maldives",
          马尔代夫: "Maldives",
          澳洲: "Australia",
          新加坡: "Singapore",
          法國: "France",
          英國: "United Kingdom",
          越南: "Vietnam",
          馬來西亞: "Malaysia",
          马来西亚: "Malaysia",
          希臘: "Greece",
          希腊: "Greece",
          西班牙: "Spain",
          義大利: "Italy",
          意大利: "Italy",
          加拿大: "Canada",
          紐西蘭: "New Zealand",
          新西兰: "New Zealand",
          土耳其: "Turkey",
          阿拉伯聯合大公國: "United Arab Emirates",
          阿聯酋: "United Arab Emirates",
        }[countryZh] ?? countryZh)
      : "") ||
    params.countryCode?.trim().toUpperCase() ||
    "";

  const queries: string[] = [];
  const pushUnique = (q: string) => {
    const t = q.trim();
    if (!t) return;
    if (!queries.includes(t)) queries.push(t);
  };

  const prefersPrefecture =
    /[県縣府]$/.test(alias.displayName) ||
    /[県縣府]$/.test(alias.normalizedName) ||
    /\b(prefecture|province|county)\b/i.test(alias.displayName);

  // Curated searchVariants first (city-before-prefecture plans live here).
  for (const variant of alias.searchVariants) {
    pushUnique(variant);
  }

  const cityStem = alias.searchName;
  const cityZh = alias.normalizedName.replace(/[市県縣府]$/, "");
  const adminEn = alias.administrativeArea?.trim() || "";
  const adminZh = alias.administrativeAreaLocal?.trim() || "";
  /** Latin search stems may take "City"; CJK stems must not become "深圳 City". */
  const stemIsLatin = /^[A-Za-z0-9\s.'’-]+$/.test(cityStem);
  const cityStemWithCity =
    stemIsLatin && !/\bcity\b/i.test(cityStem) ? `${cityStem} City` : "";
  /** Resort towns / districts resolve like cities — not islands. */
  const isCityLike =
    alias.entityType === "city" ||
    alias.entityType === "resort_area" ||
    alias.entityType === "district" ||
    (!alias.entityType && !prefersPrefecture);
  const isIslandLike =
    alias.entityType === "island" ||
    alias.entityType === "archipelago" ||
    ((alias.entityType === "region" || alias.entityType === "province" || alias.entityType === "state") &&
      /(島|岛)$/.test(alias.normalizedName));
  const isRegionLike =
    alias.entityType === "region" ||
    alias.entityType === "province" ||
    alias.entityType === "state";

  // Admin-area disambiguation (e.g. Pattaya, Chon Buri, Thailand).
  if (adminEn && countryEn) {
    pushUnique(`${cityStem}, ${adminEn}, ${countryEn}`);
    if (cityStemWithCity) pushUnique(`${cityStemWithCity}, ${adminEn}, ${countryEn}`);
  }
  if (adminZh && countryZh) {
    pushUnique(`${alias.normalizedName}，${adminZh}，${countryZh}`);
    pushUnique(`${alias.normalizedName}, ${adminZh}, ${countryZh}`);
    if (cityZh !== alias.normalizedName) {
      pushUnique(`${cityZh}市，${adminZh}，${countryZh}`);
    }
  }

  // Japan / Korea dual city–prefecture names: prefer city locality.
  if (isCityLike && (countryZh === "日本" || countryCodeForHint(countryZh) === "JP")) {
    if (!prefersPrefecture) {
      pushUnique(`${cityZh}市, ${cityZh}県, 日本`);
      pushUnique(`${cityZh}, 日本`);
      if (stemIsLatin) {
        pushUnique(`${cityStem} City, ${cityStem} Prefecture, Japan`);
        pushUnique(`${cityStem}, Japan`);
        pushUnique(`${cityStem} City`);
      }
      pushUnique(`${cityZh}市`);
    } else {
      pushUnique(`${cityZh}県, 日本`);
      if (stemIsLatin) pushUnique(`${cityStem} Prefecture, Japan`);
    }
  }

  const stems = [
    isCityLike && !prefersPrefecture ? cityStemWithCity : "",
    cityStem,
    alias.normalizedName,
    alias.displayName,
    ...alias.aliases.filter((a) => a !== alias.searchName && a !== alias.normalizedName),
  ].filter(Boolean);

  for (const stem of stems) {
    if (!stem) continue;
    if (countryEn) {
      pushUnique(`${stem}, ${countryEn}`);
      pushUnique(`${stem} ${countryEn}`);
    }
    if (countryZh && countryZh !== countryEn) {
      pushUnique(`${stem}, ${countryZh}`);
      pushUnique(`${stem} ${countryZh}`);
    }
  }

  // Island expansions only for true islands / archipelagos — never for resort towns.
  if (isIslandLike && countryEn) {
    pushUnique(`${alias.searchName} Island, ${countryEn}`);
  }
  if (isRegionLike && !isCityLike && countryEn) {
    pushUnique(`${alias.searchName} Province, ${countryEn}`);
  }
  if (countryZh) {
    pushUnique(`${alias.normalizedName} ${countryZh}`);
  }

  pushUnique(alias.searchName);
  pushUnique(alias.normalizedName);

  return queries;
}

/** Clear alias index (tests). */
export function clearDestinationAliasIndex(): void {
  aliasIndex = null;
}
