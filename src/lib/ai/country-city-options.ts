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
  summary: string;
};

/**
 * Structured country/city database — data only, queried generically.
 * Not flow control; missing countries still go through entity + fallback discovery.
 */
const STRUCTURED_COUNTRY_DESTINATIONS: StructuredSeed[] = [
  // 亞洲
  { name: "首爾", type: "city", country: "韓國", summary: "購物、咖啡廳、美食與夜生活" },
  { name: "釜山", type: "city", country: "韓國", summary: "海景、海鮮與較慢步調" },
  { name: "濟州島", type: "island", country: "韓國", summary: "自然風景、自駕與放鬆" },
  { name: "東京", type: "city", country: "日本", summary: "購物、美食、展覽與城市散策" },
  { name: "大阪", type: "city", country: "日本", summary: "美食、商圈與熱鬧夜生活" },
  { name: "京都", type: "city", country: "日本", summary: "寺院、傳統街區與季節景色" },
  { name: "名古屋", type: "city", country: "日本", summary: "城堡、美食與中部城市散策" },
  { name: "福岡", type: "city", country: "日本", summary: "美食、商圈與九州門戶" },
  { name: "橫濱", type: "city", country: "日本", summary: "港灣、倉庫區與近郊散步" },
  { name: "北海道", type: "region", country: "日本", summary: "自然、花季、雪景與較慢步調" },
  { name: "曼谷", type: "city", country: "泰國", summary: "美食、按摩、購物和城市行程" },
  { name: "清邁", type: "city", country: "泰國", summary: "寺廟、市集與較慢步調的旅行" },
  { name: "芭達雅", type: "city", country: "泰國", summary: "海灘、度假與夜生活" },
  { name: "普吉島", type: "island", country: "泰國", summary: "海灘、度假與海島活動" },
  { name: "蘇梅島", type: "island", country: "泰國", summary: "放鬆、海景與較悠閒的行程" },
  { name: "馬尼拉", type: "city", country: "菲律賓", summary: "城市景點、購物、美食與歷史街區" },
  { name: "宿霧", type: "region", country: "菲律賓", summary: "海島活動、跳島、潛水與城市行程" },
  { name: "長灘島", type: "island", country: "菲律賓", summary: "白沙灘、水上活動與度假" },
  { name: "巴拉望", type: "region", country: "菲律賓", summary: "自然景觀、潟湖、跳島與較慢旅行" },
  { name: "河內", type: "city", country: "越南", summary: "古城、咖啡與人文散步" },
  { name: "峴港", type: "city", country: "越南", summary: "海灘、中部風景與度假感" },
  { name: "胡志明", type: "city", country: "越南", summary: "都會節奏、美食與夜生活" },
  { name: "會安", type: "city", country: "越南", summary: "古鎮巷弄、燈籠與慢步調" },
  { name: "峇里島", type: "island", country: "印尼", summary: "海灘、寺廟與度假放鬆" },
  { name: "雅加達", type: "city", country: "印尼", summary: "都會節奏、購物與美食" },
  { name: "日惹", type: "city", country: "印尼", summary: "古城文化與近郊火山風景" },
  { name: "龍目島", type: "island", country: "印尼", summary: "海島活動與自然景觀" },
  { name: "吉隆坡", type: "city", country: "馬來西亞", summary: "都會地標、購物與美食" },
  { name: "檳城", type: "city", country: "馬來西亞", summary: "街道美食、喬治市與文化巷弄" },
  { name: "蘭卡威", type: "island", country: "馬來西亞", summary: "海島度假與水上活動" },
  { name: "馬六甲", type: "city", country: "馬來西亞", summary: "歷史街區、河岸與古城氣氛" },
  { name: "濱海灣", type: "region", country: "新加坡", summary: "城市天際線與園區散步" },
  { name: "牛車水", type: "region", country: "新加坡", summary: "文化巷弄與美食" },
  { name: "聖淘沙", type: "island", country: "新加坡", summary: "海島放鬆與休閒" },
  { name: "台北", type: "city", country: "台灣", summary: "都會、夜市與近郊自然" },
  { name: "台中", type: "city", country: "台灣", summary: "文創、商圈與輕旅行" },
  { name: "台南", type: "city", country: "台灣", summary: "古都巷弄、美食與慢步調" },
  { name: "高雄", type: "city", country: "台灣", summary: "港口城市、藝術與夜景" },
  { name: "花蓮", type: "region", country: "台灣", summary: "海岸、縱谷與較慢步調" },
  { name: "台東", type: "region", country: "台灣", summary: "縱谷、海岸與放鬆節奏" },
  { name: "宜蘭", type: "region", country: "台灣", summary: "溫泉、海岸與親子旅遊" },
  { name: "屏東", type: "region", country: "台灣", summary: "墾丁、東港與縣域海岸" },
  { name: "南投", type: "region", country: "台灣", summary: "日月潭、山城與自然風景" },
  { name: "嘉義", type: "region", country: "台灣", summary: "阿里山、市區與近郊風景" },
  { name: "苗栗", type: "region", country: "台灣", summary: "山城、客家風情與自然" },
  { name: "澎湖", type: "region", country: "台灣", summary: "離島海景與水上活動" },
  { name: "烏蘭巴托", type: "city", country: "蒙古", summary: "城市起點與文化體驗" },
  { name: "特勒吉", type: "region", country: "蒙古", summary: "近郊草原與自然風景" },
  { name: "戈壁", type: "region", country: "蒙古", summary: "沙漠景觀與深度旅程" },
  { name: "北京", type: "city", country: "中國", summary: "古蹟、博物館與城市散策" },
  { name: "上海", type: "city", country: "中國", summary: "都會節奏、購物與夜景" },
  { name: "深圳", type: "city", country: "中國", summary: "現代都會、科技與海岸線" },
  { name: "廣州", type: "city", country: "中國", summary: "美食、商圈與珠江夜景" },
  { name: "成都", type: "city", country: "中國", summary: "美食、慢生活與近郊自然" },
  { name: "西安", type: "city", country: "中國", summary: "古城、歷史遺址與文化" },
  { name: "金邊", type: "city", country: "柬埔寨", summary: "首都節奏、博物館與河岸" },
  { name: "暹粒", type: "city", country: "柬埔寨", summary: "吳哥窟、遺跡與文化之旅" },
  { name: "西哈努克", type: "city", country: "柬埔寨", summary: "海灘與海島跳島" },
  { name: "永珍", type: "city", country: "寮國", summary: "首都散步與河岸氣氛" },
  { name: "琅勃拉邦", type: "city", country: "寮國", summary: "古城、寺廟與慢旅行" },
  { name: "萬榮", type: "city", country: "寮國", summary: "洞穴、河流與戶外活動" },
  { name: "仰光", type: "city", country: "緬甸", summary: "大金寺、城市與文化" },
  { name: "蒲甘", type: "region", country: "緬甸", summary: "塔林遺跡與熱氣球景色" },
  { name: "曼德勒", type: "city", country: "緬甸", summary: "皇城餘韻與近郊寺院" },
  { name: "德里", type: "city", country: "印度", summary: "歷史、博物館與城市節奏" },
  { name: "齋浦爾", type: "city", country: "印度", summary: "粉紅城、宮殿與拉賈斯坦風情" },
  { name: "孟買", type: "city", country: "印度", summary: "都會、海岸與寶萊塢氣氛" },
  { name: "果阿", type: "region", country: "印度", summary: "海灘、度假與慢節奏" },
  // 歐洲
  { name: "羅馬", type: "city", country: "義大利", summary: "古蹟、博物館與城市散策" },
  { name: "佛羅倫斯", type: "city", country: "義大利", summary: "藝術、巷弄與文藝氣氛" },
  { name: "米蘭", type: "city", country: "義大利", summary: "時尚、購物與都會節奏" },
  { name: "威尼斯", type: "city", country: "義大利", summary: "水道、橋樑與慢旅行" },
  { name: "巴黎", type: "city", country: "法國", summary: "博物館、經典地標與城市散策" },
  { name: "普羅旺斯", type: "region", country: "法國", summary: "小鎮、花季與田園氣氛" },
  { name: "蔚藍海岸", type: "region", country: "法國", summary: "海岸、度假與陽光節奏" },
  { name: "里昂", type: "city", country: "法國", summary: "美食、老城與河岸散步" },
  { name: "倫敦", type: "city", country: "英國", summary: "博物館、經典地標、購物與城市散策" },
  { name: "愛丁堡", type: "city", country: "英國", summary: "古城、歷史建築與文化景色" },
  { name: "曼徹斯特", type: "city", country: "英國", summary: "音樂、足球與城市文化" },
  { name: "湖區", type: "region", country: "英國", summary: "自然風景、步道與較慢旅行" },
  { name: "阿姆斯特丹", type: "city", country: "荷蘭", summary: "運河、博物館與城市散策" },
  { name: "鹿特丹", type: "city", country: "荷蘭", summary: "現代建築、港口與都會節奏" },
  { name: "海牙", type: "city", country: "荷蘭", summary: "海岸、博物館與政治都會" },
  { name: "烏得勒支", type: "city", country: "荷蘭", summary: "運河小鎮與較慢步調" },
  { name: "柏林", type: "city", country: "德國", summary: "歷史、文創與城市散策" },
  { name: "慕尼黑", type: "city", country: "德國", summary: "啤酒文化、公園與近郊阿爾卑斯" },
  { name: "漢堡", type: "city", country: "德國", summary: "港口、運河與都會節奏" },
  { name: "科隆", type: "city", country: "德國", summary: "大教堂、萊茵河與城市散步" },
  { name: "巴塞隆納", type: "city", country: "西班牙", summary: "高第建築、海灘與城市散策" },
  { name: "馬德里", type: "city", country: "西班牙", summary: "博物館、廣場與都會節奏" },
  { name: "塞維亞", type: "city", country: "西班牙", summary: "古城、佛朗明哥與南國氣氛" },
  { name: "瓦倫西亞", type: "city", country: "西班牙", summary: "海岸、市集與輕鬆步調" },
  { name: "蘇黎世", type: "city", country: "瑞士", summary: "湖泊、城市散策與購物" },
  { name: "琉森", type: "city", country: "瑞士", summary: "湖景、老城與近郊山區" },
  { name: "日內瓦", type: "city", country: "瑞士", summary: "湖岸、國際都會與博物館" },
  { name: "因特拉肯", type: "region", country: "瑞士", summary: "阿爾卑斯健行與雪山風景" },
  { name: "里斯本", type: "city", country: "葡萄牙", summary: "山城、電車與海岸景色" },
  { name: "波爾圖", type: "city", country: "葡萄牙", summary: "河岸、酒莊與老城巷弄" },
  { name: "阿爾加維", type: "region", country: "葡萄牙", summary: "海灘、懸崖與度假" },
  { name: "雅典", type: "city", country: "希臘", summary: "古蹟、博物館與城市節奏" },
  { name: "聖托里尼", type: "island", country: "希臘", summary: "火山島、夕陽與海島度假" },
  { name: "克里特島", type: "island", country: "希臘", summary: "海岸、遺址與自駕" },
  { name: "布魯塞爾", type: "city", country: "比利時", summary: "廣場、巧克力與城市散策" },
  { name: "布魯日", type: "city", country: "比利時", summary: "運河古城與慢旅行" },
  { name: "安特衛普", type: "city", country: "比利時", summary: "時尚、鑽石與港口都會" },
  { name: "維也納", type: "city", country: "奧地利", summary: "宮殿、音樂與咖啡文化" },
  { name: "薩爾茨堡", type: "city", country: "奧地利", summary: "古城、山景與音樂之都" },
  { name: "哈爾施塔特", type: "city", country: "奧地利", summary: "湖區小鎮與阿爾卑斯景色" },
  { name: "斯德哥爾摩", type: "city", country: "瑞典", summary: "群島、老城與設計風格" },
  { name: "哥德堡", type: "city", country: "瑞典", summary: "港口、海鮮與都會節奏" },
  { name: "馬爾默", type: "city", country: "瑞典", summary: "設計、海岸與近郊丹麥" },
  { name: "奧斯陸", type: "city", country: "挪威", summary: "峽灣、博物館與城市散策" },
  { name: "卑爾根", type: "city", country: "挪威", summary: "峽灣入口、木屋與山景" },
  { name: "特羅姆瑟", type: "city", country: "挪威", summary: "極光、北極氣氛與海島" },
  { name: "哥本哈根", type: "city", country: "丹麥", summary: "設計、運河與城市散策" },
  { name: "奧胡斯", type: "city", country: "丹麥", summary: "文青都會與海岸氣氛" },
  { name: "歐登塞", type: "city", country: "丹麥", summary: "童話故鄉與小鎮節奏" },
  { name: "赫爾辛基", type: "city", country: "芬蘭", summary: "設計、海岸與薩烏那文化" },
  { name: "羅瓦涅米", type: "city", country: "芬蘭", summary: "極光、聖誕老人村與雪景" },
  { name: "土爾庫", type: "city", country: "芬蘭", summary: "古城、群島與慢旅行" },
  { name: "華沙", type: "city", country: "波蘭", summary: "古城重建、博物館與都會" },
  { name: "克拉科夫", type: "city", country: "波蘭", summary: "中世紀廣場與近郊鹽礦" },
  { name: "格但斯克", type: "city", country: "波蘭", summary: "波羅的海港口與老城" },
  { name: "布拉格", type: "city", country: "捷克", summary: "古城、橋樑與啤酒文化" },
  { name: "布爾諾", type: "city", country: "捷克", summary: "文青都會與近郊城堡" },
  { name: "克魯姆洛夫", type: "city", country: "捷克", summary: "童話古城與慢旅行" },
  { name: "布達佩斯", type: "city", country: "匈牙利", summary: "溫泉、多瑙河與夜景" },
  { name: "德布勒森", type: "city", country: "匈牙利", summary: "東部平原與宗教文化" },
  { name: "埃格爾", type: "city", country: "匈牙利", summary: "古城、酒窖與山區" },
  { name: "都柏林", type: "city", country: "愛爾蘭", summary: "酒吧文化、文學與城市散策" },
  { name: "戈爾韋", type: "city", country: "愛爾蘭", summary: "西岸小鎮與大西洋風景" },
  { name: "科克", type: "city", country: "愛爾蘭", summary: "港口城市與近郊海岸" },
  { name: "雷克雅未克", type: "city", country: "冰島", summary: "首都節奏、溫泉與極光出發點" },
  { name: "藍湖", type: "region", country: "冰島", summary: "溫泉、地熱與標誌景觀" },
  { name: "南部海岸", type: "region", country: "冰島", summary: "瀑布、黑沙灘與冰川" },
  { name: "伊斯坦堡", type: "city", country: "土耳其", summary: "跨洲城市、市集與歷史遺址" },
  { name: "卡帕多奇亞", type: "region", country: "土耳其", summary: "奇岩地貌與熱氣球" },
  { name: "安塔利亞", type: "city", country: "土耳其", summary: "地中海海岸與度假" },
  // 美洲
  { name: "紐約", type: "city", country: "美國", summary: "城市景點、百老匯、購物與博物館" },
  { name: "洛杉磯", type: "city", country: "美國", summary: "影視景點、海灘與城市公路旅行" },
  { name: "舊金山", type: "city", country: "美國", summary: "城市散策、海灣景色與近郊自然" },
  { name: "拉斯維加斯", type: "city", country: "美國", summary: "娛樂、夜生活與沙漠近郊" },
  { name: "溫哥華", type: "city", country: "加拿大", summary: "海岸、山景與城市散策" },
  { name: "多倫多", type: "city", country: "加拿大", summary: "大都會、博物館與湖岸" },
  { name: "蒙特婁", type: "city", country: "加拿大", summary: "法文文化、老城與美食" },
  { name: "班夫", type: "region", country: "加拿大", summary: "國家公園、湖泊與自然風景" },
  { name: "墨西哥城", type: "city", country: "墨西哥", summary: "博物館、美食與都會節奏" },
  { name: "坎昆", type: "city", country: "墨西哥", summary: "加勒比海灘與度假" },
  { name: "瓦哈卡", type: "city", country: "墨西哥", summary: "美食、殖民地建築與文化" },
  { name: "里約熱內盧", type: "city", country: "巴西", summary: "海灘、山景與城市節奏" },
  { name: "聖保羅", type: "city", country: "巴西", summary: "都會、美食與文化" },
  { name: "薩爾瓦多", type: "city", country: "巴西", summary: "殖民老城與海岸氣氛" },
  { name: "布宜諾斯艾利斯", type: "city", country: "阿根廷", summary: "探戈、牛排與街區散策" },
  { name: "門多薩", type: "city", country: "阿根廷", summary: "葡萄酒莊與安地斯山景" },
  { name: "烏斯懷亞", type: "city", country: "阿根廷", summary: "世界盡頭與極地氣氛" },
  { name: "聖地牙哥", type: "city", country: "智利", summary: "都會、酒莊近郊與山景" },
  { name: "巴塔哥尼亞", type: "region", country: "智利", summary: "冰河、國家公園與自然" },
  { name: "瓦爾帕萊索", type: "city", country: "智利", summary: "彩色山城與港口藝術" },
  // 大洋洲
  { name: "雪梨", type: "city", country: "澳洲", summary: "海港地標、海灘與城市散策" },
  { name: "墨爾本", type: "city", country: "澳洲", summary: "咖啡文化、巷弄與近郊景觀" },
  { name: "布里斯本", type: "city", country: "澳洲", summary: "陽光城市與近郊海岸" },
  { name: "黃金海岸", type: "city", country: "澳洲", summary: "海灘、度假與主題樂園" },
  { name: "奧克蘭", type: "city", country: "紐西蘭", summary: "海灣、火山島與城市出發點" },
  { name: "皇后鎮", type: "city", country: "紐西蘭", summary: "湖泊、極限運動與南島風景" },
  { name: "羅托魯瓦", type: "city", country: "紐西蘭", summary: "地熱、毛利文化與自然" },
  { name: "基督城", type: "city", country: "紐西蘭", summary: "南島門戶與花園城市" },
  // 非洲
  { name: "開羅", type: "city", country: "埃及", summary: "金字塔、博物館與古城" },
  { name: "盧克索", type: "city", country: "埃及", summary: "神廟、河谷與尼羅河" },
  { name: "紅海", type: "region", country: "埃及", summary: "潛水、珊瑚礁與度假" },
  { name: "馬拉喀什", type: "city", country: "摩洛哥", summary: "市集、宮殿與柏柏爾文化" },
  { name: "非斯", type: "city", country: "摩洛哥", summary: "中世紀古城與皮革工藝" },
  { name: "卡薩布蘭卡", type: "city", country: "摩洛哥", summary: "都會海岸與現代摩洛哥" },
  { name: "開普敦", type: "city", country: "南非", summary: "桌山、海岸與葡萄酒莊" },
  { name: "約翰尼斯堡", type: "city", country: "南非", summary: "都會、博物館與近郊動物園" },
  { name: "克魯格", type: "region", country: "南非", summary: "野生動物觀察與國家公園" },
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
    summary: d.summary,
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
      return { options: validated.options, source: "cache", valid: true };
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
      return { options: validated.options, source: "curated", valid: true };
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
    return { options: dynamicValidated.options, source: "dynamic", valid: true };
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
    return { options: fallbackValidated.options, source: "fallback", valid: true };
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
