import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";
/**
 * Country → city/region/island discovery for country-level reply builder.
 *
 * Priority:
 * 1. Verified curated profile cache (COUNTRY_ADVICE-derived)
 * 2. Structured country/city destination index
 * 3. Registered destination-entity children
 * 4. Geographic validation + soft fallback synthesis
 *
 * City options are keyed by country+locale (never country+month).
 * Month only enriches seasonal copy / optional summary hints.
 */

import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  listChildDestinationsByCountry,
  type DestinationEntityType,
} from "@/lib/ai/destination-entity";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

export type CountryCityOptionType = "city" | "region" | "island";

export type CountryCityOption = {
  name: string;
  type: CountryCityOptionType;
  country: string;
  /** Short trait line (~10–24 chars); rendered as 「・name：summary」. */
  summary: string;
};

export type CountryCityOptionsSource =
  | "curated"
  | "cache"
  | "dynamic"
  | "fallback";

export type BuildCountryCityOptionsParams = {
  country: string;
  month?: number | string | null;
  language?: string;
  /** Optional curated options (from COUNTRY_ADVICE). */
  curatedOptions?: Array<Omit<CountryCityOption, "country"> | CountryCityOption | string>;
};

export type BuildCountryCityOptionsResult = {
  options: CountryCityOption[];
  source: CountryCityOptionsSource;
  valid: boolean;
  reason?: string;
};

/** Abstract travel-style phrases — never valid as destination names. */
const ABSTRACT_DESTINATION_NAME_RE =
  /^(城市旅行|海島度假|美食文化|自然放鬆|城市散策|慢旅行|購物行程|度假放鬆|經典景點|美食按摩|海島放鬆|自然風光|文青路線|親子行程)$/;

const OPTION_TYPE_SET = new Set<CountryCityOptionType>(["city", "region", "island"]);

type StructuredSeed = {
  name: string;
  type: CountryCityOptionType;
  country: string;
  summaryKey: string;
};

/**
 * Structured country/city database — data only, queried generically.
 * Not flow control; missing countries still go through entity + fallback discovery.
 */
const STRUCTURED_COUNTRY_DESTINATIONS: StructuredSeed[] = [
  // 亞洲
  { name: "首爾", type: "city", country: "韓國", summaryKey: "summary_9f13ba5a73" },
  { name: "釜山", type: "city", country: "韓國", summaryKey: "summary_c9a631ecdd" },
  { name: "濟州島", type: "island", country: "韓國", summaryKey: "summary_d515143b55" },
  { name: "東京", type: "city", country: "日本", summaryKey: "summary_3d5a745cc8" },
  { name: "大阪", type: "city", country: "日本", summaryKey: "summary_97989d6054" },
  { name: "京都", type: "city", country: "日本", summaryKey: "summary_8fa01730f9" },
  { name: "名古屋", type: "city", country: "日本", summaryKey: "summary_316bfbd9a6" },
  { name: "福岡", type: "city", country: "日本", summaryKey: "summary_8002affd73" },
  { name: "橫濱", type: "city", country: "日本", summaryKey: "summary_bdb0f03dc8" },
  { name: "北海道", type: "region", country: "日本", summaryKey: "summary_db4bdebe7c" },
  { name: "曼谷", type: "city", country: "泰國", summaryKey: "summary_c970aa2e3a" },
  { name: "清邁", type: "city", country: "泰國", summaryKey: "summary_6391d7f0b3" },
  { name: "芭達雅", type: "city", country: "泰國", summaryKey: "summary_a330ec5bfb" },
  { name: "普吉島", type: "island", country: "泰國", summaryKey: "summary_129d7e93ec" },
  { name: "蘇梅島", type: "island", country: "泰國", summaryKey: "summary_6f9a3f69f5" },
  { name: "馬尼拉", type: "city", country: "菲律賓", summaryKey: "summary_9f26982c50" },
  { name: "宿霧", type: "region", country: "菲律賓", summaryKey: "summary_48237d5de5" },
  { name: "長灘島", type: "island", country: "菲律賓", summaryKey: "summary_af6fce87ff" },
  { name: "巴拉望", type: "region", country: "菲律賓", summaryKey: "summary_2dcf57ede7" },
  { name: "河內", type: "city", country: "越南", summaryKey: "summary_ba971b844c" },
  { name: "峴港", type: "city", country: "越南", summaryKey: "summary_a0e78969cf" },
  { name: "胡志明", type: "city", country: "越南", summaryKey: "summary_4067666b37" },
  { name: "會安", type: "city", country: "越南", summaryKey: "summary_f054cf8ff9" },
  { name: "峇里島", type: "island", country: "印尼", summaryKey: "summary_96ede32b2e" },
  { name: "雅加達", type: "city", country: "印尼", summaryKey: "summary_73c4577e08" },
  { name: "日惹", type: "city", country: "印尼", summaryKey: "summary_75f8980c3f" },
  { name: "龍目島", type: "island", country: "印尼", summaryKey: "summary_337ddff39f" },
  { name: "吉隆坡", type: "city", country: "馬來西亞", summaryKey: "summary_b47372c71e" },
  { name: "檳城", type: "city", country: "馬來西亞", summaryKey: "summary_53c1f10929" },
  { name: "蘭卡威", type: "island", country: "馬來西亞", summaryKey: "summary_6c08e0dd87" },
  { name: "馬六甲", type: "city", country: "馬來西亞", summaryKey: "summary_ab8008d5df" },
  { name: "濱海灣", type: "region", country: "新加坡", summaryKey: "summary_ecaa67f35a" },
  { name: "牛車水", type: "region", country: "新加坡", summaryKey: "summary_84d0d5bf27" },
  { name: "聖淘沙", type: "island", country: "新加坡", summaryKey: "summary_88cfec9367" },
  { name: "台北", type: "city", country: "台灣", summaryKey: "summary_4e2d17f39f" },
  { name: "台中", type: "city", country: "台灣", summaryKey: "summary_d8f7a6ce40" },
  { name: "台南", type: "city", country: "台灣", summaryKey: "summary_7f4f058c70" },
  { name: "高雄", type: "city", country: "台灣", summaryKey: "summary_a611af3484" },
  { name: "花蓮", type: "region", country: "台灣", summaryKey: "summary_59aeebcd17" },
  { name: "台東", type: "region", country: "台灣", summaryKey: "summary_11cda9b12e" },
  { name: "宜蘭", type: "region", country: "台灣", summaryKey: "summary_490f2ef8be" },
  { name: "屏東", type: "region", country: "台灣", summaryKey: "summary_5485ef6629" },
  { name: "南投", type: "region", country: "台灣", summaryKey: "summary_17eac85838" },
  { name: "嘉義", type: "region", country: "台灣", summaryKey: "summary_fd6ef0a8c2" },
  { name: "苗栗", type: "region", country: "台灣", summaryKey: "summary_11757c0dfa" },
  { name: "澎湖", type: "region", country: "台灣", summaryKey: "summary_31fd10053a" },
  { name: "烏蘭巴托", type: "city", country: "蒙古", summaryKey: "summary_2e68e13c5e" },
  { name: "特勒吉", type: "region", country: "蒙古", summaryKey: "summary_cdb6eaf13d" },
  { name: "戈壁", type: "region", country: "蒙古", summaryKey: "summary_227c5f07fb" },
  { name: "北京", type: "city", country: "中國", summaryKey: "summary_0ec5a22198" },
  { name: "上海", type: "city", country: "中國", summaryKey: "summary_6437b113cf" },
  { name: "深圳", type: "city", country: "中國", summaryKey: "summary_cbb12e7fc8" },
  { name: "廣州", type: "city", country: "中國", summaryKey: "summary_98ace3adaa" },
  { name: "成都", type: "city", country: "中國", summaryKey: "summary_d7de205145" },
  { name: "西安", type: "city", country: "中國", summaryKey: "summary_01101173c1" },
  { name: "金邊", type: "city", country: "柬埔寨", summaryKey: "summary_73bdafb634" },
  { name: "暹粒", type: "city", country: "柬埔寨", summaryKey: "summary_d405b6296e" },
  { name: "西哈努克", type: "city", country: "柬埔寨", summaryKey: "summary_8f47bad98e" },
  { name: "永珍", type: "city", country: "寮國", summaryKey: "summary_de7c16005d" },
  { name: "琅勃拉邦", type: "city", country: "寮國", summaryKey: "summary_4cc561cec0" },
  { name: "萬榮", type: "city", country: "寮國", summaryKey: "summary_b00de0ce85" },
  { name: "仰光", type: "city", country: "緬甸", summaryKey: "summary_48f69e54a5" },
  { name: "蒲甘", type: "region", country: "緬甸", summaryKey: "summary_372b5499eb" },
  { name: "曼德勒", type: "city", country: "緬甸", summaryKey: "summary_815456fada" },
  { name: "德里", type: "city", country: "印度", summaryKey: "summary_db5948e83d" },
  { name: "齋浦爾", type: "city", country: "印度", summaryKey: "summary_5c7dfd81d3" },
  { name: "孟買", type: "city", country: "印度", summaryKey: "summary_776ff41178" },
  { name: "果阿", type: "region", country: "印度", summaryKey: "summary_39dfecd837" },
  // 歐洲
  { name: "羅馬", type: "city", country: "義大利", summaryKey: "summary_0ec5a22198" },
  { name: "佛羅倫斯", type: "city", country: "義大利", summaryKey: "summary_3d16648dde" },
  { name: "米蘭", type: "city", country: "義大利", summaryKey: "summary_adf2b19f50" },
  { name: "威尼斯", type: "city", country: "義大利", summaryKey: "summary_f379485342" },
  { name: "巴黎", type: "city", country: "法國", summaryKey: "summary_eb92e00dd9" },
  { name: "普羅旺斯", type: "region", country: "法國", summaryKey: "summary_8148407e4e" },
  { name: "蔚藍海岸", type: "region", country: "法國", summaryKey: "summary_49859d7be1" },
  { name: "里昂", type: "city", country: "法國", summaryKey: "summary_9f61db2e53" },
  { name: "倫敦", type: "city", country: "英國", summaryKey: "summary_4e80309fbf" },
  { name: "愛丁堡", type: "city", country: "英國", summaryKey: "summary_fd9434ec08" },
  { name: "曼徹斯特", type: "city", country: "英國", summaryKey: "summary_83cfbdf84d" },
  { name: "湖區", type: "region", country: "英國", summaryKey: "summary_341c008169" },
  { name: "阿姆斯特丹", type: "city", country: "荷蘭", summaryKey: "summary_51e58fd9fb" },
  { name: "鹿特丹", type: "city", country: "荷蘭", summaryKey: "summary_f542e2b63c" },
  { name: "海牙", type: "city", country: "荷蘭", summaryKey: "summary_8f3dc8374e" },
  { name: "烏得勒支", type: "city", country: "荷蘭", summaryKey: "summary_5752e61fa4" },
  { name: "柏林", type: "city", country: "德國", summaryKey: "summary_2de45fc7c4" },
  { name: "慕尼黑", type: "city", country: "德國", summaryKey: "summary_76d278f9fd" },
  { name: "漢堡", type: "city", country: "德國", summaryKey: "summary_f36ecfb7ef" },
  { name: "科隆", type: "city", country: "德國", summaryKey: "summary_c3200f7949" },
  { name: "巴塞隆納", type: "city", country: "西班牙", summaryKey: "summary_37b5fd346b" },
  { name: "馬德里", type: "city", country: "西班牙", summaryKey: "summary_7ba3e2e32f" },
  { name: "塞維亞", type: "city", country: "西班牙", summaryKey: "summary_3573ec5b33" },
  { name: "瓦倫西亞", type: "city", country: "西班牙", summaryKey: "summary_5aed824c8b" },
  { name: "蘇黎世", type: "city", country: "瑞士", summaryKey: "summary_9b7c1d97b7" },
  { name: "琉森", type: "city", country: "瑞士", summaryKey: "summary_816ccbdc70" },
  { name: "日內瓦", type: "city", country: "瑞士", summaryKey: "summary_05361cfe3d" },
  { name: "因特拉肯", type: "region", country: "瑞士", summaryKey: "summary_5e944d6f3b" },
  { name: "里斯本", type: "city", country: "葡萄牙", summaryKey: "summary_f63a461301" },
  { name: "波爾圖", type: "city", country: "葡萄牙", summaryKey: "summary_27fa9358d0" },
  { name: "阿爾加維", type: "region", country: "葡萄牙", summaryKey: "summary_1c008a4e4c" },
  { name: "雅典", type: "city", country: "希臘", summaryKey: "summary_f9aaa9f4c2" },
  { name: "聖托里尼", type: "island", country: "希臘", summaryKey: "summary_d59753ab31" },
  { name: "克里特島", type: "island", country: "希臘", summaryKey: "summary_9a8279be19" },
  { name: "布魯塞爾", type: "city", country: "比利時", summaryKey: "summary_d6e124eb61" },
  { name: "布魯日", type: "city", country: "比利時", summaryKey: "summary_e4a8d5bf32" },
  { name: "安特衛普", type: "city", country: "比利時", summaryKey: "summary_7e7e663d11" },
  { name: "維也納", type: "city", country: "奧地利", summaryKey: "summary_06ba8e4fdb" },
  { name: "薩爾茨堡", type: "city", country: "奧地利", summaryKey: "summary_d9faddef82" },
  { name: "哈爾施塔特", type: "city", country: "奧地利", summaryKey: "summary_c2a0d4311f" },
  { name: "斯德哥爾摩", type: "city", country: "瑞典", summaryKey: "summary_be757347c9" },
  { name: "哥德堡", type: "city", country: "瑞典", summaryKey: "summary_3affa852f7" },
  { name: "馬爾默", type: "city", country: "瑞典", summaryKey: "summary_779df50af6" },
  { name: "奧斯陸", type: "city", country: "挪威", summaryKey: "summary_470ee582d0" },
  { name: "卑爾根", type: "city", country: "挪威", summaryKey: "summary_1d1ee557b2" },
  { name: "特羅姆瑟", type: "city", country: "挪威", summaryKey: "summary_72fb2e0860" },
  { name: "哥本哈根", type: "city", country: "丹麥", summaryKey: "summary_e7b8afcc06" },
  { name: "奧胡斯", type: "city", country: "丹麥", summaryKey: "summary_a101762e80" },
  { name: "歐登塞", type: "city", country: "丹麥", summaryKey: "summary_373870f740" },
  { name: "赫爾辛基", type: "city", country: "芬蘭", summaryKey: "summary_92a1137c42" },
  { name: "羅瓦涅米", type: "city", country: "芬蘭", summaryKey: "summary_b8b0d562df" },
  { name: "土爾庫", type: "city", country: "芬蘭", summaryKey: "summary_cee7592234" },
  { name: "華沙", type: "city", country: "波蘭", summaryKey: "summary_6bf6de8f2b" },
  { name: "克拉科夫", type: "city", country: "波蘭", summaryKey: "summary_e402407f9f" },
  { name: "格但斯克", type: "city", country: "波蘭", summaryKey: "summary_8bc103cc52" },
  { name: "布拉格", type: "city", country: "捷克", summaryKey: "summary_c053f1a085" },
  { name: "布爾諾", type: "city", country: "捷克", summaryKey: "summary_8ad5e91be1" },
  { name: "克魯姆洛夫", type: "city", country: "捷克", summaryKey: "summary_23bf7ed556" },
  { name: "布達佩斯", type: "city", country: "匈牙利", summaryKey: "summary_34bdccad8d" },
  { name: "德布勒森", type: "city", country: "匈牙利", summaryKey: "summary_4d006b537a" },
  { name: "埃格爾", type: "city", country: "匈牙利", summaryKey: "summary_c477317760" },
  { name: "都柏林", type: "city", country: "愛爾蘭", summaryKey: "summary_3038dc0a3c" },
  { name: "戈爾韋", type: "city", country: "愛爾蘭", summaryKey: "summary_b5d44cbdd5" },
  { name: "科克", type: "city", country: "愛爾蘭", summaryKey: "summary_5f92556d10" },
  { name: "雷克雅未克", type: "city", country: "冰島", summaryKey: "summary_430fe6a660" },
  { name: "藍湖", type: "region", country: "冰島", summaryKey: "summary_f665a5a85d" },
  { name: "南部海岸", type: "region", country: "冰島", summaryKey: "summary_5b8c40a60f" },
  { name: "伊斯坦堡", type: "city", country: "土耳其", summaryKey: "summary_083441a514" },
  { name: "卡帕多奇亞", type: "region", country: "土耳其", summaryKey: "summary_7bb947bc68" },
  { name: "安塔利亞", type: "city", country: "土耳其", summaryKey: "summary_fbe76f71db" },
  // 美洲
  { name: "紐約", type: "city", country: "美國", summaryKey: "summary_fb9b77ff81" },
  { name: "洛杉磯", type: "city", country: "美國", summaryKey: "summary_aa74e721ea" },
  { name: "舊金山", type: "city", country: "美國", summaryKey: "summary_f5d5dbd7f3" },
  { name: "拉斯維加斯", type: "city", country: "美國", summaryKey: "summary_11f7dbaaad" },
  { name: "溫哥華", type: "city", country: "加拿大", summaryKey: "summary_62f451aa23" },
  { name: "多倫多", type: "city", country: "加拿大", summaryKey: "summary_b2646312fe" },
  { name: "蒙特婁", type: "city", country: "加拿大", summaryKey: "summary_0d98bb44d9" },
  { name: "班夫", type: "region", country: "加拿大", summaryKey: "summary_5b510c3e47" },
  { name: "墨西哥城", type: "city", country: "墨西哥", summaryKey: "summary_c0c13b05d3" },
  { name: "坎昆", type: "city", country: "墨西哥", summaryKey: "summary_927df4f0aa" },
  { name: "瓦哈卡", type: "city", country: "墨西哥", summaryKey: "summary_c30e02f368" },
  { name: "里約熱內盧", type: "city", country: "巴西", summaryKey: "summary_22c8ea3524" },
  { name: "聖保羅", type: "city", country: "巴西", summaryKey: "summary_ab33602645" },
  { name: "薩爾瓦多", type: "city", country: "巴西", summaryKey: "summary_aa46dc4afb" },
  { name: "布宜諾斯艾利斯", type: "city", country: "阿根廷", summaryKey: "summary_d860d4455b" },
  { name: "門多薩", type: "city", country: "阿根廷", summaryKey: "summary_51e1926035" },
  { name: "烏斯懷亞", type: "city", country: "阿根廷", summaryKey: "summary_50fd69cb03" },
  { name: "聖地牙哥", type: "city", country: "智利", summaryKey: "summary_20ee6deafe" },
  { name: "巴塔哥尼亞", type: "region", country: "智利", summaryKey: "summary_72e00576ee" },
  { name: "瓦爾帕萊索", type: "city", country: "智利", summaryKey: "summary_8a0354078a" },
  // 大洋洲
  { name: "雪梨", type: "city", country: "澳洲", summaryKey: "summary_16ea4b4c1d" },
  { name: "墨爾本", type: "city", country: "澳洲", summaryKey: "summary_f9e848fbda" },
  { name: "布里斯本", type: "city", country: "澳洲", summaryKey: "summary_fae51d0dda" },
  { name: "黃金海岸", type: "city", country: "澳洲", summaryKey: "summary_554aeb5b39" },
  { name: "奧克蘭", type: "city", country: "紐西蘭", summaryKey: "summary_01baf39d67" },
  { name: "皇后鎮", type: "city", country: "紐西蘭", summaryKey: "summary_289bf14372" },
  { name: "羅托魯瓦", type: "city", country: "紐西蘭", summaryKey: "summary_5bf06b9bcc" },
  { name: "基督城", type: "city", country: "紐西蘭", summaryKey: "summary_bacd4baf1a" },
  // 非洲
  { name: "開羅", type: "city", country: "埃及", summaryKey: "summary_50243634e2" },
  { name: "盧克索", type: "city", country: "埃及", summaryKey: "summary_c3bc96b075" },
  { name: "紅海", type: "region", country: "埃及", summaryKey: "summary_2b4a4e17e4" },
  { name: "馬拉喀什", type: "city", country: "摩洛哥", summaryKey: "summary_33bbac54a9" },
  { name: "非斯", type: "city", country: "摩洛哥", summaryKey: "summary_347c122df3" },
  { name: "卡薩布蘭卡", type: "city", country: "摩洛哥", summaryKey: "summary_bb87373538" },
  { name: "開普敦", type: "city", country: "南非", summaryKey: "summary_c5d0c1b973" },
  { name: "約翰尼斯堡", type: "city", country: "南非", summaryKey: "summary_2589353d57" },
  { name: "克魯格", type: "region", country: "南非", summaryKey: "summary_a339c49902" },
];

/** cityOptions cache: country + locale (month must NOT be part of the key). */
const cityOptionsCache = new Map<string, CountryCityOption[]>();

/** Seasonal profile cache key helper — kept separate from city options. */
export function seasonalProfileCacheKey(
  country: string,
  month: number,
  year?: number | null,
): string {
  const c = normalizeDestinationLabel(country);
  return year ? `${c}|${month}|${year}` : `${c}|${month}`;
}

export function cityOptionsCacheKey(country: string, language = "zh-TW"): string {
  return `${normalizeDestinationLabel(country)}|${language}`;
}

function parseMonthNum(month?: number | string | null): number | null {
  if (month == null || month === "") return null;
  const n = Number(String(month).replace(/\D/g, ""));
  return n >= 1 && n <= 12 ? n : null;
}

function toOptionType(raw: string | undefined): CountryCityOptionType {
  if (raw === "region" || raw === "island") return raw;
  return "city";
}

function entityTypeToOptionType(type: DestinationEntityType): CountryCityOptionType | null {
  if (type === "city" || type === "city_state" || type === "region" || type === "island") {
    return type === "city_state" ? "city" : type;
  }
  if (type === "state" || type === "province") return "region";
  if (type === "resort_area") return "region";
  return null;
}

function defaultSummaryForType(type: CountryCityOptionType): string {
  if (type === "island") return "海島活動、度假與自然風景";
  if (type === "region") return "地區風景、行程彈性與在地體驗";
  return "城市散策與在地體驗";
}

function normalizeOneOption(
  opt: Omit<CountryCityOption, "country"> | CountryCityOption | string,
  country: string,
): CountryCityOption | null {
  if (typeof opt === "string") {
    const name = normalizeDestinationLabel(opt);
    if (!name) return null;
    return { name, type: "city", country, summary: defaultSummaryForType("city") };
  }
  const name = normalizeDestinationLabel(String(opt.name ?? ""));
  if (!name) return null;
  const type = toOptionType(opt.type);
  const summary = String(opt.summary ?? "").trim() || defaultSummaryForType(type);
  return { name, type, country, summary };
}

export function normalizeCountryCityOptions(
  options: Array<Omit<CountryCityOption, "country"> | CountryCityOption | string> | undefined,
  country: string,
): CountryCityOption[] {
  if (!options?.length) return [];
  const label = normalizeDestinationLabel(country);
  const out: CountryCityOption[] = [];
  const seen = new Set<string>();
  for (const opt of options) {
    const normalized = normalizeOneOption(opt, label);
    if (!normalized) continue;
    if (seen.has(normalized.name)) continue;
    seen.add(normalized.name);
    out.push(normalized);
    if (out.length >= 5) break;
  }
  return out;
}

export type ValidateCountryCityOptionsResult = {
  ok: boolean;
  reason?: string;
  options: CountryCityOption[];
};

/**
 * Validates city/region/island options before country reply builder output.
 */
export function validateCountryCityOptions(
  cityOptions: CountryCityOption[],
  country: string,
): ValidateCountryCityOptionsResult {
  const label = normalizeDestinationLabel(country);
  if (!cityOptions.length) {
    return { ok: false, reason: "empty", options: [] };
  }
  if (cityOptions.length < 3) {
    return { ok: false, reason: `count_lt_3:${cityOptions.length}`, options: cityOptions };
  }
  if (cityOptions.length > 5) {
    return {
      ok: false,
      reason: `count_gt_5:${cityOptions.length}`,
      options: cityOptions.slice(0, 5),
    };
  }

  const seen = new Set<string>();
  const cleaned: CountryCityOption[] = [];

  for (const opt of cityOptions) {
    const name = normalizeDestinationLabel(opt.name ?? "");
    if (!name) {
      return { ok: false, reason: "empty_name", options: cityOptions };
    }
    if (name === label) {
      return { ok: false, reason: `country_as_city:${name}`, options: cityOptions };
    }
    if (ABSTRACT_DESTINATION_NAME_RE.test(name)) {
      return { ok: false, reason: `abstract_name:${name}`, options: cityOptions };
    }
    if (!OPTION_TYPE_SET.has(opt.type)) {
      return { ok: false, reason: `invalid_type:${opt.type}`, options: cityOptions };
    }
    const optCountry = normalizeDestinationLabel(opt.country || label);
    if (optCountry !== label) {
      return {
        ok: false,
        reason: `country_mismatch:${optCountry}!=${label}`,
        options: cityOptions,
      };
    }
    if (!String(opt.summary ?? "").trim()) {
      return { ok: false, reason: `empty_summary:${name}`, options: cityOptions };
    }
    if (seen.has(name)) {
      return { ok: false, reason: `duplicate:${name}`, options: cityOptions };
    }
    seen.add(name);

    cleaned.push({
      name,
      type: opt.type,
      country: label,
      summary: String(opt.summary).trim(),
    });
  }

  return { ok: true, options: cleaned };
}

function queryStructuredDestinations(country: string): CountryCityOption[] {
  const label = normalizeDestinationLabel(country);
  return STRUCTURED_COUNTRY_DESTINATIONS.filter(
    (d) => normalizeDestinationLabel(d.country) === label,
  ).map((d) => ({
    name: normalizeDestinationLabel(d.name),
    type: d.type,
    country: label,
    summary: translate("zh-TW", `destinationEditorial.${d.summaryKey}`),
  }));
}

/** Look up parent country from the structured city/region index. */
export function lookupStructuredCountryForCity(city: string): string | undefined {
  const label = normalizeDestinationLabel(city);
  if (!label) return undefined;
  const hit = STRUCTURED_COUNTRY_DESTINATIONS.find(
    (d) => normalizeDestinationLabel(d.name) === label,
  );
  return hit ? normalizeDestinationLabel(hit.country) : undefined;
}

function discoverFromEntities(country: string): CountryCityOption[] {
  const label = normalizeDestinationLabel(country);
  const children = listChildDestinationsByCountry(label);
  const out: CountryCityOption[] = [];
  for (const child of children) {
    const type = entityTypeToOptionType(child.type);
    if (!type) continue;
    const note = child.seasonality.notes[0]?.trim();
    out.push({
      name: child.name,
      type,
      country: label,
      summary: note && note.length <= 28 ? note : defaultSummaryForType(type),
    });
  }
  return out;
}

/**
 * Light month-aware summary enrichment — never removes options.
 */
function enrichSummariesForMonth(
  options: CountryCityOption[],
  month: number | null,
): CountryCityOption[] {
  if (!month) return options;
  return options.map((opt) => {
    // Keep structured summaries intact; month is mainly for seasonalHighlight elsewhere.
    return opt;
  });
}

function mergeUniqueOptions(
  ...groups: CountryCityOption[][]
): CountryCityOption[] {
  const seen = new Set<string>();
  const out: CountryCityOption[] = [];
  for (const group of groups) {
    for (const opt of group) {
      if (seen.has(opt.name)) continue;
      seen.add(opt.name);
      out.push(opt);
      if (out.length >= 5) return out;
    }
  }
  return out;
}

function takeValidSlice(
  options: CountryCityOption[],
  country: string,
): ValidateCountryCityOptionsResult {
  const normalized = normalizeCountryCityOptions(options, country);
  // Prefer 3–5; if more than 5 already sliced by normalize.
  if (normalized.length >= 3) {
    return validateCountryCityOptions(normalized.slice(0, Math.min(5, normalized.length)), country);
  }
  return validateCountryCityOptions(normalized, country);
}

/**
 * Build 3–5 concrete city/region/island options for any country.
 * Month must not gate city discovery.
 */
export function buildCountryCityOptions(
  params: BuildCountryCityOptionsParams,
): BuildCountryCityOptionsResult {
  const country = normalizeDestinationLabel(params.country);
  const language = params.language ?? "zh-TW";
  const monthNum = parseMonthNum(params.month);
  const cacheKey = cityOptionsCacheKey(country, language);

  logAiPipeline(
    "[COUNTRY_CITY_OPTIONS_DISCOVERY_START]",
    `country=${country}`,
    `month=${monthNum == null ? "none" : String(monthNum)}`,
  );

  const cached = cityOptionsCache.get(cacheKey);
  if (cached?.length) {
    const validated = validateCountryCityOptions(cached, country);
    if (validated.ok) {
      logAiPipeline("[COUNTRY_CITY_OPTIONS_SOURCE]", "source=cache");
      logAiPipeline(
        "[COUNTRY_CITY_OPTIONS_BUILT]",
        `country=${country}`,
        `count=${validated.options.length}`,
        `options=[${validated.options.map((o) => o.name).join(",")}]`,
      );
      return { options: projectCountryCitySummaries(validated.options, language), source: "cache", valid: true };
    }
  }

  // 1) Curated profile
  if (params.curatedOptions?.length) {
    const curated = enrichSummariesForMonth(
      normalizeCountryCityOptions(params.curatedOptions, country),
      monthNum,
    );
    const validated = takeValidSlice(curated, country);
    if (validated.ok) {
      cityOptionsCache.set(cacheKey, validated.options);
      logAiPipeline("[COUNTRY_CITY_OPTIONS_SOURCE]", "source=curated");
      logAiPipeline(
        "[COUNTRY_CITY_OPTIONS_BUILT]",
        `country=${country}`,
        `count=${validated.options.length}`,
        `options=[${validated.options.map((o) => o.name).join(",")}]`,
      );
      return { options: projectCountryCitySummaries(validated.options, language), source: "curated", valid: true };
    }
    logAiPipeline(
      "[COUNTRY_CITY_OPTIONS_VALIDATION_FAILED]",
      `country=${country}`,
      `reason=${validated.reason ?? "curated_invalid"}`,
      `count=${curated.length}`,
    );
  }

  // 2) Structured destination index + 3) entity children
  const structured = enrichSummariesForMonth(queryStructuredDestinations(country), monthNum);
  const fromEntities = enrichSummariesForMonth(discoverFromEntities(country), monthNum);
  const dynamicMerged = mergeUniqueOptions(structured, fromEntities);
  const dynamicValidated = takeValidSlice(dynamicMerged, country);
  if (dynamicValidated.ok) {
    cityOptionsCache.set(cacheKey, dynamicValidated.options);
    logAiPipeline("[COUNTRY_CITY_OPTIONS_SOURCE]", "source=dynamic");
    logAiPipeline(
      "[COUNTRY_CITY_OPTIONS_BUILT]",
      `country=${country}`,
      `count=${dynamicValidated.options.length}`,
      `options=[${dynamicValidated.options.map((o) => o.name).join(",")}]`,
    );
    return { options: projectCountryCitySummaries(dynamicValidated.options, language), source: "dynamic", valid: true };
  }

  if (dynamicMerged.length) {
    logAiPipeline(
      "[COUNTRY_CITY_OPTIONS_VALIDATION_FAILED]",
      `country=${country}`,
      `reason=${dynamicValidated.reason ?? "dynamic_invalid"}`,
      `count=${dynamicMerged.length}`,
    );
  }

  // 4) Fallback: merge everything available, pad with geo-safe entity notes
  logAiPipeline("[COUNTRY_CITY_OPTIONS_FALLBACK_STARTED]", `country=${country}`);
  const curatedAgain = params.curatedOptions
    ? normalizeCountryCityOptions(params.curatedOptions, country)
    : [];
  const fallbackMerged = mergeUniqueOptions(curatedAgain, structured, fromEntities);
  const fallbackValidated = takeValidSlice(fallbackMerged, country);
  if (fallbackValidated.ok) {
    cityOptionsCache.set(cacheKey, fallbackValidated.options);
    logAiPipeline("[COUNTRY_CITY_OPTIONS_SOURCE]", "source=fallback");
    logAiPipeline(
      "[COUNTRY_CITY_OPTIONS_BUILT]",
      `country=${country}`,
      `count=${fallbackValidated.options.length}`,
      `options=[${fallbackValidated.options.map((o) => o.name).join(",")}]`,
    );
    return { options: projectCountryCitySummaries(fallbackValidated.options, language), source: "fallback", valid: true };
  }

  logAiPipeline(
    "[COUNTRY_CITY_OPTIONS_VALIDATION_FAILED]",
    `country=${country}`,
    `reason=${fallbackValidated.reason ?? "fallback_invalid"}`,
    `count=${fallbackMerged.length}`,
  );
  logAiPipeline("[COUNTRY_CITY_OPTIONS_EMPTY_BLOCKED]", `country=${country}`);

  return {
    options: [],
    source: "fallback",
    valid: false,
    reason: fallbackValidated.reason ?? "empty_after_fallback",
  };
}

/** Test / hot-reload helper. */
export function clearCountryCityOptionsCache(): void {
  cityOptionsCache.clear();
}

/** Expose structured coverage for verify scripts. */
export function listStructuredCountries(): string[] {
  return [
    ...new Set(
      STRUCTURED_COUNTRY_DESTINATIONS.map((d) => normalizeDestinationLabel(d.country)),
    ),
  ].sort();
}

/** Display-only projection. Destination identity, type and ordering remain canonical. */
export function projectCountryCitySummaries(options: CountryCityOption[], language: string): CountryCityOption[] {
  const locale: Locale = language === "en" || language === "ja" || language === "ko" ? language : "zh-TW";
  return options.map((option) => {
    const seed = STRUCTURED_COUNTRY_DESTINATIONS.find((candidate) =>
      normalizeDestinationLabel(candidate.name) === option.name &&
      normalizeDestinationLabel(candidate.country) === option.country);
    return { ...option, summary: locale === "zh-TW" && option.summary ? option.summary : seed
      ? translate(locale, `destinationEditorial.${seed.summaryKey}`)
      : locale === "zh-TW" ? option.summary
      : translate(locale, `destinationEditorial.fallback_${option.type}`) };
  });
}

/** All editorial records, independent of the 3–5 option selection limit. */
export function structuredDestinationOptions(locale: Locale): CountryCityOption[] {
  return projectCountryCitySummaries(STRUCTURED_COUNTRY_DESTINATIONS.map((seed) => ({
    name: normalizeDestinationLabel(seed.name), country: normalizeDestinationLabel(seed.country),
    type: seed.type, summary: "",
  })), locale);
}
