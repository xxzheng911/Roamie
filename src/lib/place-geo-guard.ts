/**
 * 同名不同國家地點的地理防護（純函式、無網路呼叫）。
 *
 * 名稱解析（Autocomplete 候選）與 Details 回來後的合併前，都用這裡判斷
 * 「候選／抓回的地點」是否落在 handoff 的地理脈絡（地址、城市、國家、座標）內。
 * 靜態資料只用來比對與推估中心點；不新增任何 Google／AI 呼叫。
 *
 * 座標推國家不用矩形國家框（框會互相重疊）：改以「最近的已知城市中心點」判斷，
 * 超出距離上限或邊界模糊時回 null（視為 unknown，不丟棄、不拒絕）。
 */
import { distanceMeters } from "@/lib/geo-distance";

type LatLng = { lat: number; lng: number };

type CountryDef = { code: string; names: readonly string[] };
type CityDef = { names: readonly string[]; country: string; center: LatLng };

const COUNTRIES: readonly CountryDef[] = [
  { code: "TW", names: ["taiwan", "台灣", "台湾", "대만", "中華民國"] },
  { code: "JP", names: ["japan", "日本", "일본"] },
  {
    code: "KR",
    names: [
      "south korea",
      "korea",
      "republic of korea",
      "韓國",
      "韩国",
      "韓国",
      "대한민국",
      "한국",
      "大韓民国",
      "大韓民國",
    ],
  },
  {
    code: "CN",
    names: ["china", "中國", "中国", "中华人民共和国", "中華人民共和國", "中華人民共和国", "중국"],
  },
  {
    code: "HK",
    names: [
      "hong kong",
      "hong kong sar",
      "hong kong sar china",
      "hong kong s.a.r",
      "香港",
      "香港特別行政區",
      "香港特别行政区",
      "홍콩",
    ],
  },
  {
    code: "MO",
    names: [
      "macau",
      "macao",
      "macau sar",
      "macao sar",
      "macau sar china",
      "macao sar china",
      "澳門",
      "澳门",
      "澳門特別行政區",
      "澳门特别行政区",
      "マカオ",
      "마카오",
    ],
  },
  {
    code: "RU",
    names: ["russia", "russian federation", "俄羅斯", "俄罗斯", "ロシア", "러시아", "россия"],
  },
  { code: "MN", names: ["mongolia", "蒙古", "モンゴル", "몽골", "монгол"] },
  {
    code: "AU",
    names: [
      "australia",
      "nsw",
      "queensland",
      "澳洲",
      "澳大利亞",
      "澳大利亚",
      "オーストラリア",
      "호주",
      "오스트레일리아",
    ],
  },
  {
    code: "NZ",
    names: [
      "new zealand",
      "aotearoa",
      "紐西蘭",
      "新西蘭",
      "新西兰",
      "ニュージーランド",
      "뉴질랜드",
    ],
  },
  { code: "TH", names: ["thailand", "泰國", "泰国", "タイ王国", "태국", "ประเทศไทย"] },
  { code: "VN", names: ["vietnam", "viet nam", "việt nam", "越南", "ベトナム", "베트남"] },
  { code: "SG", names: ["singapore", "新加坡", "シンガポール", "싱가포르"] },
  { code: "MY", names: ["malaysia", "馬來西亞", "马来西亚", "マレーシア", "말레이시아"] },
  {
    code: "ID",
    names: ["indonesia", "印尼", "印度尼西亞", "印度尼西亚", "インドネシア", "인도네시아"],
  },
  { code: "PH", names: ["philippines", "pilipinas", "菲律賓", "菲律宾", "フィリピン", "필리핀"] },
  { code: "KH", names: ["cambodia", "柬埔寨", "カンボジア", "캄보디아", "កម្ពុជា"] },
  { code: "MV", names: ["maldives", "馬爾地夫", "马尔代夫", "モルディブ", "몰디브"] },
  // 「印度尼西亞／インドネシア／인도네시아」在 normalizeGeoText 先換成 indonesia，避免誤判為印度。
  { code: "IN", names: ["india", "bharat", "印度", "インド", "인도", "भारत"] },
  {
    code: "AE",
    names: [
      "united arab emirates",
      "uae",
      "阿聯酋",
      "阿联酋",
      "阿拉伯聯合大公國",
      "アラブ首長国連邦",
      "아랍에미리트",
    ],
  },
  {
    code: "US",
    names: [
      "usa",
      "u.s.a",
      "u.s",
      "united states",
      "united states of america",
      "美國",
      "美国",
      "アメリカ合衆国",
      "미국",
    ],
  },
  { code: "CA", names: ["canada", "加拿大", "カナダ", "캐나다"] },
  { code: "MX", names: ["mexico", "méxico", "墨西哥", "メキシコ", "멕시코"] },
  {
    code: "GB",
    names: [
      "united kingdom",
      "uk",
      "u.k",
      "great britain",
      "england",
      "scotland",
      "wales",
      "英國",
      "英国",
      "イギリス",
      "영국",
    ],
  },
  { code: "IE", names: ["ireland", "éire", "愛爾蘭", "爱尔兰", "アイルランド", "아일랜드"] },
  { code: "FR", names: ["france", "法國", "法国", "フランス", "프랑스"] },
  { code: "IT", names: ["italy", "italia", "義大利", "意大利", "イタリア", "이탈리아"] },
  { code: "ES", names: ["spain", "españa", "西班牙", "スペイン", "스페인"] },
  { code: "PT", names: ["portugal", "葡萄牙", "ポルトガル", "포르투갈"] },
  { code: "DE", names: ["germany", "deutschland", "德國", "德国", "ドイツ", "독일"] },
  { code: "NL", names: ["netherlands", "nederland", "荷蘭", "荷兰", "オランダ", "네덜란드"] },
  {
    code: "BE",
    names: ["belgium", "belgique", "belgië", "比利時", "比利时", "ベルギー", "벨기에"],
  },
  {
    code: "CH",
    names: ["switzerland", "schweiz", "suisse", "svizzera", "瑞士", "スイス", "스위스"],
  },
  {
    code: "AT",
    names: ["austria", "österreich", "奧地利", "奥地利", "オーストリア", "오스트리아"],
  },
  {
    code: "CZ",
    names: ["czechia", "czech republic", "česko", "česká republika", "捷克", "チェコ", "체코"],
  },
  { code: "GR", names: ["greece", "hellas", "ελλάδα", "希臘", "希腊", "ギリシャ", "그리스"] },
  {
    code: "TR",
    names: ["turkey", "türkiye", "turkiye", "土耳其", "トルコ", "튀르키예", "터키"],
  },
  { code: "EG", names: ["egypt", "埃及", "エジプト", "이집트", "مصر"] },
  { code: "IS", names: ["iceland", "ísland", "冰島", "冰岛", "アイスランド", "아이슬란드"] },
];

/** 中心點沿用 destination-geocode 的近似中心（唯讀複製），其餘為公開城市中心概略值。 */
const CITIES: readonly CityDef[] = [
  { names: ["台北", "taipei"], country: "TW", center: { lat: 25.033, lng: 121.5654 } },
  { names: ["新北", "new taipei"], country: "TW", center: { lat: 25.012, lng: 121.4657 } },
  { names: ["基隆", "keelung"], country: "TW", center: { lat: 25.1276, lng: 121.7392 } },
  { names: ["桃園", "taoyuan"], country: "TW", center: { lat: 24.9936, lng: 121.301 } },
  { names: ["新竹", "hsinchu"], country: "TW", center: { lat: 24.8138, lng: 120.9675 } },
  { names: ["苗栗", "miaoli"], country: "TW", center: { lat: 24.564, lng: 120.823 } },
  { names: ["台中", "taichung"], country: "TW", center: { lat: 24.1477, lng: 120.6736 } },
  { names: ["彰化", "changhua"], country: "TW", center: { lat: 24.08, lng: 120.54 } },
  { names: ["南投", "nantou"], country: "TW", center: { lat: 23.9157, lng: 120.6639 } },
  { names: ["雲林", "yunlin"], country: "TW", center: { lat: 23.7092, lng: 120.4313 } },
  { names: ["嘉義", "chiayi"], country: "TW", center: { lat: 23.4801, lng: 120.4491 } },
  { names: ["台南", "tainan"], country: "TW", center: { lat: 22.9997, lng: 120.227 } },
  { names: ["高雄", "kaohsiung"], country: "TW", center: { lat: 22.6273, lng: 120.3014 } },
  { names: ["屏東", "pingtung"], country: "TW", center: { lat: 22.669, lng: 120.489 } },
  { names: ["宜蘭", "yilan"], country: "TW", center: { lat: 24.757, lng: 121.753 } },
  { names: ["花蓮", "hualien"], country: "TW", center: { lat: 23.9871, lng: 121.6015 } },
  { names: ["台東", "taitung"], country: "TW", center: { lat: 22.758, lng: 121.1444 } },
  { names: ["澎湖", "penghu"], country: "TW", center: { lat: 23.5711, lng: 119.5793 } },
  { names: ["金門", "kinmen"], country: "TW", center: { lat: 24.4493, lng: 118.3767 } },
  { names: ["東京", "tokyo", "도쿄"], country: "JP", center: { lat: 35.6762, lng: 139.6503 } },
  { names: ["大阪", "osaka", "오사카"], country: "JP", center: { lat: 34.6937, lng: 135.5023 } },
  { names: ["京都", "kyoto", "교토"], country: "JP", center: { lat: 35.0116, lng: 135.7681 } },
  { names: ["名古屋", "nagoya", "나고야"], country: "JP", center: { lat: 35.1815, lng: 136.9066 } },
  {
    names: ["福岡", "fukuoka", "후쿠오카"],
    country: "JP",
    center: { lat: 33.5904, lng: 130.4017 },
  },
  { names: ["札幌", "sapporo", "삿포로"], country: "JP", center: { lat: 43.0618, lng: 141.3545 } },
  {
    names: ["北海道", "hokkaido", "홋카이도"],
    country: "JP",
    center: { lat: 43.0618, lng: 141.3545 },
  },
  {
    names: ["沖繩", "沖縄", "okinawa", "오키나와"],
    country: "JP",
    center: { lat: 26.2124, lng: 127.6809 },
  },
  { names: ["那霸", "那覇", "naha"], country: "JP", center: { lat: 26.2124, lng: 127.6809 } },
  {
    names: ["橫濱", "横浜", "yokohama", "요코하마"],
    country: "JP",
    center: { lat: 35.4437, lng: 139.638 },
  },
  {
    names: ["神戶", "神戸", "kobe", "고베"],
    country: "JP",
    center: { lat: 34.6901, lng: 135.1955 },
  },
  { names: ["奈良", "nara"], country: "JP", center: { lat: 34.6851, lng: 135.8048 } },
  { names: ["廣島", "広島", "hiroshima"], country: "JP", center: { lat: 34.3853, lng: 132.4553 } },
  { names: ["鎌倉", "kamakura"], country: "JP", center: { lat: 35.319, lng: 139.5467 } },
  { names: ["箱根", "hakone"], country: "JP", center: { lat: 35.2324, lng: 139.1069 } },
  {
    names: ["首爾", "首尔", "seoul", "서울", "ソウル"],
    country: "KR",
    center: { lat: 37.5665, lng: 126.978 },
  },
  {
    names: ["釜山", "busan", "부산", "プサン"],
    country: "KR",
    center: { lat: 35.1796, lng: 129.0756 },
  },
  {
    names: ["濟州", "济州", "jeju", "제주", "チェジュ"],
    country: "KR",
    center: { lat: 33.4996, lng: 126.5312 },
  },
  { names: ["上海", "shanghai"], country: "CN", center: { lat: 31.2304, lng: 121.4737 } },
  { names: ["北京", "beijing"], country: "CN", center: { lat: 39.9042, lng: 116.4074 } },
  { names: ["深圳", "shenzhen"], country: "CN", center: { lat: 22.5431, lng: 114.0579 } },
  {
    names: ["曼谷", "bangkok", "방콕", "バンコク"],
    country: "TH",
    center: { lat: 13.7563, lng: 100.5018 },
  },
  { names: ["清邁", "清迈", "chiang mai"], country: "TH", center: { lat: 18.7883, lng: 98.9853 } },
  { names: ["普吉", "phuket"], country: "TH", center: { lat: 7.8804, lng: 98.3923 } },
  { names: ["芭達雅", "pattaya"], country: "TH", center: { lat: 12.9236, lng: 100.8825 } },
  { names: ["河內", "河内", "hanoi"], country: "VN", center: { lat: 21.0278, lng: 105.8342 } },
  { names: ["胡志明", "ho chi minh"], country: "VN", center: { lat: 10.8231, lng: 106.6297 } },
  {
    names: ["峴港", "岘港", "da nang", "danang"],
    country: "VN",
    center: { lat: 16.0544, lng: 108.2022 },
  },
  { names: ["吉隆坡", "kuala lumpur"], country: "MY", center: { lat: 3.139, lng: 101.6869 } },
  { names: ["峇里", "巴厘", "bali"], country: "ID", center: { lat: -8.4095, lng: 115.1889 } },
  { names: ["宿霧", "cebu"], country: "PH", center: { lat: 10.3157, lng: 123.8854 } },
  { names: ["馬尼拉", "manila"], country: "PH", center: { lat: 14.5995, lng: 120.9842 } },
  {
    names: ["雪梨", "悉尼", "sydney", "シドニー", "시드니"],
    country: "AU",
    center: { lat: -33.8688, lng: 151.2093 },
  },
  {
    names: ["墨爾本", "墨尔本", "melbourne", "メルボルン", "멜버른"],
    country: "AU",
    center: { lat: -37.8136, lng: 144.9631 },
  },
  { names: ["布里斯本", "brisbane"], country: "AU", center: { lat: -27.4698, lng: 153.0251 } },
  { names: ["auckland"], country: "NZ", center: { lat: -36.8485, lng: 174.7633 } },
  {
    names: ["烏蘭巴托", "乌兰巴托", "ulaanbaatar", "ulan bator", "ウランバートル", "울란바토르"],
    country: "MN",
    center: { lat: 47.8864, lng: 106.9057 },
  },
  {
    names: ["紐約", "纽约", "new york", "뉴욕", "ニューヨーク"],
    country: "US",
    center: { lat: 40.7128, lng: -74.006 },
  },
  {
    names: ["洛杉磯", "洛杉矶", "los angeles", "로스앤젤레스", "ロサンゼルス"],
    country: "US",
    center: { lat: 34.0522, lng: -118.2437 },
  },
  {
    names: ["舊金山", "旧金山", "san francisco"],
    country: "US",
    center: { lat: 37.7749, lng: -122.4194 },
  },
  {
    names: ["夏威夷", "hawaii", "honolulu"],
    country: "US",
    center: { lat: 21.3069, lng: -157.8583 },
  },
  {
    names: ["溫哥華", "温哥华", "vancouver"],
    country: "CA",
    center: { lat: 49.2827, lng: -123.1207 },
  },
  {
    names: ["多倫多", "多伦多", "toronto"],
    country: "CA",
    center: { lat: 43.6532, lng: -79.3832 },
  },
  {
    names: ["倫敦", "伦敦", "london", "런던", "ロンドン"],
    country: "GB",
    center: { lat: 51.5074, lng: -0.1278 },
  },
  { names: ["愛丁堡", "edinburgh"], country: "GB", center: { lat: 55.9533, lng: -3.1883 } },
  {
    names: ["巴黎", "paris", "파리", "パリ"],
    country: "FR",
    center: { lat: 48.8566, lng: 2.3522 },
  },
  { names: ["羅馬", "罗马", "rome"], country: "IT", center: { lat: 41.9028, lng: 12.4964 } },
  {
    names: ["佛羅倫斯", "florence", "firenze"],
    country: "IT",
    center: { lat: 43.7696, lng: 11.2558 },
  },
  { names: ["威尼斯", "venice", "venezia"], country: "IT", center: { lat: 45.4408, lng: 12.3155 } },
  {
    names: ["巴塞隆納", "巴塞罗那", "barcelona"],
    country: "ES",
    center: { lat: 41.3874, lng: 2.1686 },
  },
  { names: ["馬德里", "马德里", "madrid"], country: "ES", center: { lat: 40.4168, lng: -3.7038 } },
  { names: ["布拉格", "prague", "praha"], country: "CZ", center: { lat: 50.0755, lng: 14.4378 } },
  { names: ["開羅", "开罗", "cairo"], country: "EG", center: { lat: 30.0444, lng: 31.2357 } },
  { names: ["伊斯坦堡", "istanbul"], country: "TR", center: { lat: 41.0082, lng: 28.9784 } },
  { names: ["雷克雅維克", "reykjavik"], country: "IS", center: { lat: 64.1466, lng: -21.9426 } },
];

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/**
 * 只用於「座標推國家」的已知地點中心（不參與文字比對，避免影響地址／城市辨識）。
 * 含 destination-geocode DESTINATION_APPROX_CENTER 中 CITIES 沒有的項目（唯讀複製），
 * 其餘為公開城市／離島中心概略值。只收 COUNTRIES 有建模的國家。
 * 格式：[國家碼, lat, lng]
 */
const COORD_ANCHORS_EXTRA: readonly (readonly [string, number, number])[] = [
  // destination-geocode DESTINATION_APPROX_CENTER
  ["TW", 23.508, 120.801], // 阿里山
  ["SG", 1.3521, 103.8198], // 新加坡
  ["GB", 53.4808, -2.2426], // 曼徹斯特
  ["GB", 54.4609, -3.0886], // 湖區
  ["HK", 22.3193, 114.1694], // 香港
  ["MO", 22.1987, 113.5439], // 澳門
  ["PH", 11.9674, 121.9248], // 長灘島
  // 台灣離島與觀光區
  ["TW", 21.9483, 120.7798], // 墾丁
  ["TW", 26.1505, 119.9499], // 馬祖南竿
  ["TW", 26.3667, 120.4833], // 馬祖東引
  ["TW", 22.0446, 121.548], // 蘭嶼
  ["TW", 22.6597, 121.4906], // 綠島
  ["TW", 23.8571, 120.9157], // 日月潭
  // 日本
  ["JP", 41.7687, 140.7288], // 函館
  ["JP", 34.2028, 129.2878], // 對馬 嚴原
  ["JP", 34.6536, 129.4757], // 對馬 比田勝
  ["JP", 33.8834, 130.8752], // 北九州
  ["JP", 32.7503, 129.8779], // 長崎
  ["JP", 32.6955, 128.841], // 五島 福江
  ["JP", 33.7495, 129.6912], // 壹岐
  ["JP", 33.9578, 130.9414], // 下關
  ["JP", 24.3448, 124.1572], // 石垣
  ["JP", 24.4683, 122.9886], // 與那國
  ["JP", 45.4156, 141.6731], // 稚內
  ["JP", 42.9849, 144.3814], // 釧路
  ["JP", 27.0944, 142.1917], // 小笠原 父島
  ["JP", 38.2682, 140.8694], // 仙台
  ["JP", 31.5966, 130.5571], // 鹿兒島
  ["JP", 36.5613, 136.6562], // 金澤
  ["JP", 33.8392, 132.7657], // 松山
  // 韓國
  ["KR", 36.019, 129.3435], // 浦項
  ["KR", 35.5384, 129.3114], // 蔚山
  ["KR", 34.8806, 128.6211], // 巨濟
  ["KR", 37.4844, 130.9057], // 鬱陵島
  ["KR", 37.2411, 131.8647], // 獨島
  ["KR", 37.7519, 128.8761], // 江陵
  ["KR", 38.207, 128.5918], // 束草
  ["KR", 35.8562, 129.2247], // 慶州
  ["KR", 37.4563, 126.7052], // 仁川
  ["KR", 35.8714, 128.6014], // 大邱
  ["KR", 35.1595, 126.8526], // 光州
  ["KR", 34.7604, 127.6622], // 麗水
  // 俄羅斯
  ["RU", 43.1155, 131.8855], // 海參崴
  ["RU", 42.824, 132.8927], // 納霍德卡
  ["RU", 48.4802, 135.0719], // 哈巴羅夫斯克
  ["RU", 55.7558, 37.6173], // 莫斯科
  ["RU", 59.9311, 30.3609], // 聖彼得堡
  ["RU", 46.9591, 142.738], // 南薩哈林斯克
  ["RU", 55.7961, 49.1064], // 喀山
  ["RU", 52.2869, 104.305], // 伊爾庫茨克
  // 中國
  ["CN", 42.8628, 130.3667], // 琿春
  ["CN", 22.817, 108.3665], // 南寧
  ["CN", 22.2707, 113.5767], // 珠海
  ["CN", 22.2166, 113.5481], // 珠海 拱北
  ["CN", 22.1333, 113.5333], // 珠海 橫琴
  ["CN", 22.5485, 114.1315], // 深圳 羅湖
  ["CN", 40.1292, 124.3947], // 丹東
  ["CN", 38.914, 121.6147], // 大連
  ["CN", 36.0671, 120.3826], // 青島
  ["CN", 24.4798, 118.0894], // 廈門
  ["CN", 26.0745, 119.2965], // 福州（馬祖對岸，讓福建沿海不被判成台灣）
  ["CN", 24.8741, 118.6758], // 泉州
  ["CN", 29.65, 91.1], // 拉薩
  ["CN", 49.2122, 119.7364], // 海拉爾
  ["CN", 42.2578, 118.8869], // 赤峰
  ["CN", 23.1291, 113.2644], // 廣州
  ["CN", 30.5728, 104.0668], // 成都
  ["CN", 34.3416, 108.9398], // 西安
  ["CN", 30.2741, 120.1551], // 杭州
  ["CN", 45.8038, 126.535], // 哈爾濱
  ["CN", 25.0389, 102.7183], // 昆明
  ["CN", 29.563, 106.5516], // 重慶
  ["CN", 25.2736, 110.29], // 桂林
  ["CN", 32.0603, 118.7969], // 南京
  // 香港、澳門
  ["HK", 22.4445, 114.0222], // 元朗
  ["MO", 22.1567, 113.5583], // 氹仔
  // 東南亞
  ["TH", 17.4138, 102.7872], // 烏隆他尼
  ["TH", 16.4419, 102.8356], // 孔敬
  ["TH", 12.2428, 102.5175], // 達叻
  ["TH", 7.0086, 100.4747], // 合艾
  ["TH", 8.0863, 98.9063], // 喀比
  ["TH", 14.3532, 100.5689], // 大城
  ["VN", 10.0452, 105.7469], // 芹苴
  ["VN", 10.2899, 103.984], // 富國島
  ["VN", 16.4637, 107.5909], // 順化
  ["VN", 15.8801, 108.338], // 會安
  ["VN", 12.2388, 109.1967], // 芽莊
  ["VN", 22.3364, 103.8438], // 沙壩
  ["KH", 11.5564, 104.9282], // 金邊
  ["KH", 13.3671, 103.8448], // 暹粒
  ["MY", 1.4556, 103.7611], // 新山
  ["MY", 1.4964, 103.7425], // 新山 Larkin
  ["MY", 5.4141, 100.3288], // 檳城
  ["MY", 6.35, 99.8], // 蘭卡威
  ["MY", 5.9804, 116.0735], // 亞庇
  ["MY", 2.1896, 102.2501], // 馬六甲
  ["MY", 1.5533, 110.3592], // 古晉
  ["ID", 1.1301, 104.0529], // 巴淡島
  ["ID", -6.2088, 106.8456], // 雅加達
  ["ID", -7.7956, 110.3695], // 日惹
  ["PH", 20.4487, 121.9702], // 巴丹群島 Basco
  ["PH", 7.1907, 125.4553], // 達沃
  ["PH", 9.7392, 118.7353], // 公主港
  ["MV", 4.1755, 73.5093], // 馬列
  // 南亞、中東、非洲
  ["IN", 28.6139, 77.209], // 德里
  ["IN", 19.076, 72.8777], // 孟買
  ["IN", 12.9716, 77.5946], // 班加羅爾
  ["IN", 22.5726, 88.3639], // 加爾各答
  ["IN", 26.9124, 75.7873], // 齋浦爾
  ["IN", 27.1767, 78.0081], // 阿格拉
  ["AE", 25.2048, 55.2708], // 杜拜
  ["AE", 24.4539, 54.3773], // 阿布達比
  ["EG", 25.6872, 32.6396], // 路克索
  ["EG", 24.0889, 32.8998], // 亞斯文
  ["EG", 27.2579, 33.8116], // 赫爾格達
  ["EG", 31.2001, 29.9187], // 亞歷山卓
  // 大洋洲
  ["AU", -31.9505, 115.8605], // 伯斯
  ["AU", -34.9285, 138.6007], // 阿得雷德
  ["AU", -16.9186, 145.7781], // 凱恩斯
  ["AU", -28.0167, 153.4], // 黃金海岸
  ["AU", -35.2809, 149.13], // 坎培拉
  ["AU", -42.8821, 147.3272], // 荷巴特
  ["AU", -12.4634, 130.8456], // 達爾文
  ["AU", -31.5553, 159.0821], // 豪勳爵島
  ["NZ", -45.0312, 168.6626], // 皇后鎮
  ["NZ", -43.5321, 172.6362], // 基督城
  ["NZ", -41.2865, 174.7762], // 威靈頓
  ["NZ", -38.1368, 176.2497], // 羅托魯瓦
  // 北美
  ["US", 47.6062, -122.3321], // 西雅圖
  ["US", 45.5152, -122.6784], // 波特蘭
  ["US", 32.7157, -117.1611], // 聖地牙哥
  ["US", 36.1699, -115.1398], // 拉斯維加斯
  ["US", 29.7604, -95.3698], // 休士頓
  ["US", 29.9511, -90.0715], // 紐奧良
  ["US", 25.7617, -80.1918], // 邁阿密
  ["US", 28.5383, -81.3792], // 奧蘭多
  ["US", 41.8781, -87.6298], // 芝加哥
  ["US", 42.3601, -71.0589], // 波士頓
  ["US", 38.9072, -77.0369], // 華盛頓
  ["US", 61.2181, -149.9003], // 安克拉治
  ["US", 51.88, -176.6581], // 阿留申 Adak
  ["US", 13.4443, 144.7937], // 關島
  ["CA", 48.4284, -123.3656], // 維多利亞
  ["CA", 45.5017, -73.5673], // 蒙特婁
  ["CA", 46.8139, -71.208], // 魁北克市
  ["CA", 45.4215, -75.6972], // 渥太華
  ["CA", 51.0447, -114.0719], // 卡加利
  ["CA", 51.1784, -115.5708], // 班夫
  ["MX", 21.1619, -86.8515], // 坎昆
  ["MX", 19.4326, -99.1332], // 墨西哥城
  ["MX", 32.5149, -117.0382], // 提華納
  ["MX", 20.6597, -103.3496], // 瓜達拉哈拉
  // 歐洲
  ["GB", 54.5973, -5.9301], // 貝爾法斯特
  ["GB", 53.4084, -2.9916], // 利物浦
  ["GB", 55.8642, -4.2518], // 格拉斯哥
  ["GB", 51.752, -1.2577], // 牛津
  ["GB", 52.2053, 0.1218], // 劍橋
  ["IE", 53.3498, -6.2603], // 都柏林
  ["IE", 53.2707, -9.0568], // 戈爾韋
  ["IE", 51.8985, -8.4756], // 科克
  ["FR", 50.6292, 3.0573], // 里爾
  ["FR", 48.5734, 7.7521], // 史特拉斯堡
  ["FR", 43.7102, 7.262], // 尼斯
  ["FR", 43.6047, 1.4442], // 土魯斯
  ["FR", 43.6108, 3.8767], // 蒙彼利埃
  ["FR", 41.9192, 8.7386], // 阿雅克肖
  ["FR", 45.764, 4.8357], // 里昂
  ["FR", 43.2965, 5.3698], // 馬賽
  ["FR", 44.8378, -0.5792], // 波爾多
  ["BE", 50.8503, 4.3517], // 布魯塞爾
  ["BE", 51.2194, 4.4025], // 安特衛普
  ["BE", 51.2093, 3.2247], // 布魯日
  ["NL", 52.3676, 4.9041], // 阿姆斯特丹
  ["NL", 51.9244, 4.4777], // 鹿特丹
  ["DE", 48.1351, 11.582], // 慕尼黑
  ["DE", 51.0504, 13.7373], // 德勒斯登
  ["DE", 52.52, 13.405], // 柏林
  ["DE", 50.1109, 8.6821], // 法蘭克福
  ["DE", 53.5511, 9.9937], // 漢堡
  ["DE", 50.9375, 6.9603], // 科隆
  ["DE", 48.7758, 9.1829], // 斯圖加特
  ["DE", 49.4521, 11.0767], // 紐倫堡
  ["AT", 48.2082, 16.3738], // 維也納
  ["AT", 47.8095, 13.055], // 薩爾斯堡
  ["AT", 47.2692, 11.4041], // 因斯布魯克
  ["AT", 47.5622, 13.6493], // 哈修塔特
  ["CH", 47.3769, 8.5417], // 蘇黎世
  ["CH", 46.2044, 6.1432], // 日內瓦
  ["CH", 47.0502, 8.3093], // 琉森
  ["CH", 46.6863, 7.8632], // 因特拉肯
  ["CH", 46.948, 7.4474], // 伯恩
  ["CH", 46.0037, 8.9511], // 盧加諾
  ["IT", 45.4642, 9.19], // 米蘭
  ["IT", 45.8081, 9.0852], // 科莫
  ["IT", 46.4983, 11.3548], // 波札諾
  ["IT", 40.8518, 14.2681], // 拿坡里
  ["IT", 45.0703, 7.6869], // 杜林
  ["IT", 44.4949, 11.3426], // 波隆那
  ["IT", 43.7228, 10.4017], // 比薩
  ["IT", 38.1157, 13.3615], // 巴勒摩
  ["ES", 37.3891, -5.9845], // 塞維亞
  ["ES", 39.4699, -0.3763], // 瓦倫西亞
  ["ES", 37.1773, -3.5986], // 格拉納達
  ["ES", 36.7213, -4.4214], // 馬拉加
  ["ES", 43.263, -2.935], // 畢爾包
  ["ES", 39.5696, 2.6502], // 帕爾馬
  ["ES", 28.2916, -16.6291], // 特內里費
  ["ES", 35.8894, -5.3213], // 休達
  ["PT", 38.7223, -9.1393], // 里斯本
  ["PT", 41.1579, -8.6291], // 波多
  ["PT", 37.0194, -7.9304], // 法魯
  ["PT", 32.6669, -16.9241], // 豐沙爾
  ["PT", 37.7412, -25.6756], // 蓬塔德爾加達
  ["CZ", 48.8127, 14.3175], // 庫倫洛夫
  ["CZ", 49.1951, 16.6068], // 布爾諾
  ["GR", 37.9838, 23.7275], // 雅典
  ["GR", 40.6401, 22.9444], // 塞薩洛尼基
  ["GR", 36.3932, 25.4615], // 聖托里尼
  ["GR", 37.4467, 25.3289], // 米克諾斯
  ["GR", 35.3387, 25.1442], // 伊拉克利翁
  ["TR", 38.4237, 27.1428], // 伊茲密爾
  ["TR", 38.6431, 34.8289], // 卡帕多奇亞
  ["TR", 39.9334, 32.8597], // 安卡拉
  ["TR", 36.8969, 30.7133], // 安塔利亞
  ["IS", 65.6885, -18.1262], // 阿克雷里
  ["IS", 63.4186, -19.006], // 維克
];

type CoordAnchor = { country: string; center: LatLng };

const COORD_ANCHORS: readonly CoordAnchor[] = [
  ...CITIES.map((c) => ({ country: c.country, center: c.center })),
  ...COORD_ANCHORS_EXTRA.map(([country, lat, lng]) => ({ country, center: { lat, lng } })),
];

/**
 * 跨國都會區／國界熱點：圈內一律不推國家（城市中心離國界只有數公里，最近中心點會判到鄰國）。
 * 格式：[lat, lng, 半徑 km]
 */
const CROSS_BORDER_ZONES: readonly (readonly [number, number, number])[] = [
  [48.58, 7.77, 20], // 史特拉斯堡／Kehl
  [47.57, 7.6, 25], // 巴塞爾三國交界
  [46.2, 6.14, 30], // 日內瓦／Annemasse、Ferney、Divonne
  [47.8, 12.99, 25], // 薩爾斯堡／Freilassing、Bad Reichenhall、貝希特斯加登
  [47.6, 9.4, 35], // 波登湖（康斯坦茲／Kreuzlingen／Bregenz）
  [45.87, 9.0, 20], // 科莫／Chiasso／盧加諾
  [43.75, 7.45, 20], // 尼斯東側／摩納哥／Menton
  [50.68, 3.15, 20], // 里爾／Tournai、Mouscron
  [50.78, 5.95, 25], // 亞琛／馬斯垂克／列日三國交界
  [36.14, -5.35, 15], // 直布羅陀／La Línea
  [32.54, -117.03, 30], // 聖地牙哥／Tijuana
  [49.0, -122.75, 20], // Peace Arch（溫哥華南／Blaine）
  [43.09, -79.06, 20], // 尼加拉瀑布兩側
  [42.32, -83.03, 15], // 底特律／Windsor
  [31.75, -106.46, 20], // El Paso／Juárez
  [1.4, 103.75, 35], // 新加坡／新山
  // 澳門與珠海中心只差數公里，只圈口岸周邊，其餘交給 15 km／3 倍條件。
  [22.216, 113.549, 1.5], // 關閘／拱北口岸
  [22.14, 113.543, 1.5], // 路氹／橫琴交界
  [22.52, 114.08, 22], // 深圳／香港新界
  [22.5, 103.95, 15], // 河口／老街
  [48.99, -123.05, 12], // Point Roberts／Tsawwassen
  [48.4, 134.7, 25], // 黑瞎子島（哈巴羅夫斯克對岸）
];

function inCrossBorderZone(p: LatLng): boolean {
  return CROSS_BORDER_ZONES.some(([lat, lng, km]) => distanceMeters(p, { lat, lng }) <= km * 1000);
}

/** 最近已知地點超過此距離就不推國家（寧可判不出，也不判錯）。 */
export const COORD_COUNTRY_MAX_KM = 50;
/** 此半徑內出現其他國家的已知地點時，需通過倍數檢查。 */
const COORD_COUNTRY_RIVAL_RADIUS_KM = 150;
/** 其他國家已知地點至少要比最近點遠這麼多倍，才採用最近點的國家。 */
const COORD_COUNTRY_AMBIGUITY_RATIO = 3;
/** 150 km 內有他國已知地點時，最近已知地點必須在此距離內（邊境城鎮易跨國，如貝希特斯加登↔薩爾斯堡）。 */
const COORD_COUNTRY_BORDER_MAX_KM = 15;

/**
 * 保守的座標推國家：最近已知地點在 50 km 內，且 150 km 內沒有他國已知地點才採用；
 * 150 km 內有他國已知地點時，需最近點在 15 km 內且他國地點至少遠 3 倍。
 * 其餘一律 null。台灣也走同一條件
 * （isTaiwanCoordinates 的框涵蓋福建沿海，不能單獨用來判 TW）。
 */
function countryFromCoords(p: LatLng): string | null {
  if (inCrossBorderZone(p)) return null;
  let nearest: { country: string; d: number } | null = null;
  const dists: { country: string; d: number }[] = [];
  for (const a of COORD_ANCHORS) {
    const d = distanceMeters(p, a.center);
    dists.push({ country: a.country, d });
    if (!nearest || d < nearest.d) nearest = { country: a.country, d };
  }
  if (!nearest || nearest.d > COORD_COUNTRY_MAX_KM * 1000) return null;
  const best = nearest;
  const rival = dists.reduce(
    (min, x) => (x.country !== best.country && x.d < min ? x.d : min),
    Infinity,
  );
  if (rival <= COORD_COUNTRY_RIVAL_RADIUS_KM * 1000) {
    // 鄰近有他國已知地點（邊境、離島）：只接受非常貼近已知中心點、且他國遠 3 倍以上。
    if (best.d > COORD_COUNTRY_BORDER_MAX_KM * 1000) return null;
    if (rival < best.d * COORD_COUNTRY_AMBIGUITY_RATIO) return null;
  }
  return best.country;
}

/** 小寫、NFKC、台/臺 異體字統一，並把會誤判國家的片語先換掉。 */
export function normalizeGeoText(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/臺/g, "台")
    .replace(/new south wales/g, "nsw")
    .replace(/taiwan\s*\(r\.?o\.?c\.?\)|republic of china\s*\(taiwan\)/g, "taiwan")
    .replace(/northern ireland/g, "uk")
    .replace(/new mexico/g, "usa")
    .replace(/[內内]蒙古/g, "中国")
    .replace(/印度尼西[亞亚]|インドネシア|인도네시아/g, "indonesia");
}

const LATIN_NAME = /^[a-z0-9 .'À-ɏ-]+$/;

/** 國名（正規化後）→ 國家碼；只做「整段相等」比對，不做子字串比對。 */
const COUNTRY_BY_NAME = new Map<string, string>(
  COUNTRIES.flatMap((c) => c.names.map((n) => [n, c.code] as const)),
);

/** 非拉丁字母國名（中日韓等），供「地址開頭國名前綴」比對；長的優先。 */
const PREFIX_COUNTRY_NAMES: readonly { name: string; code: string }[] = COUNTRIES.flatMap((c) =>
  c.names.filter((n) => !LATIN_NAME.test(n)).map((name) => ({ name, code: c.code })),
).sort((a, b) => b.name.length - a.name.length);

/** 地址分段：逗號（中英日）、分號，以及前後有空白的破折號（例：杜拜地址的「 - 」）。 */
const SEGMENT_SPLIT = /[,，、;；]|\s[-–—]\s/;
/** 地址開頭的郵遞區號、數字與標點（例：「110台灣…」「〒556-0005」）。 */
const LEADING_NOISE = /^[\s\d〒#.,，、:：;；()（）\-−–—]+/u;
/** 國名前綴後緊接道路／地名字樣時不是國名（例：日本橋、中国自動車道、中國城）。 */
const CJK_PREFIX_BLOCK =
  /^(?:公路|大道|大通|路|街|通|橋|自動車道|城|地方|道|村|町|學校|学校|公園|公园|會館|会館|会馆|館|馆|料理|餐廳|餐厅|レストラン)/;
const HANGUL = /[가-힯]/;
const KATAKANA = /[゠-ヿ]/;

function prefixBoundaryOk(name: string, next: string): boolean {
  if (!next) return true;
  const c = next[0];
  // 韓文、片假名國名後面緊接同類文字時是另一個詞（例：인도어、インドカレー）。
  if (HANGUL.test(name) && HANGUL.test(c)) return false;
  if (KATAKANA.test(name) && KATAKANA.test(c)) return false;
  return !CJK_PREFIX_BLOCK.test(next);
}

/** CJK 地址開頭的國名前綴（可連續，例：「中國香港…」→ CN、HK）。 */
function addPrefixCountries(norm: string, out: Set<string>): void {
  let rest = norm;
  const found: string[] = [];
  for (let i = 0; i < 3; i++) {
    rest = rest.replace(LEADING_NOISE, "");
    const hit = PREFIX_COUNTRY_NAMES.find(
      ({ name }) => rest.startsWith(name) && prefixBoundaryOk(name, rest.slice(name.length)),
    );
    if (!hit) break;
    found.push(hit.code);
    rest = rest.slice(hit.name.length);
  }
  // 「中國香港」「中国澳门」：以特別行政區為準，不算中國。
  const sar = found.includes("HK") || found.includes("MO");
  for (const code of found) if (!(sar && code === "CN")) out.add(code);
}

/** 只有漢字國名可當「結尾」國名（zh-TW 外國地址，例：「…NY 10028美國」「…WC1B 3DG英國」）。 */
const HAN_SUFFIX_COUNTRY_NAMES = PREFIX_COUNTRY_NAMES.filter(({ name }) =>
  /^\p{Script=Han}+$/u.test(name),
);

/** 結尾國名前面必須是郵遞區號（含數字的詞）、數字或空白。 */
function addSuffixCountry(lastRaw: string, out: Set<string>): void {
  const seg = lastRaw.trim();
  const hit = HAN_SUFFIX_COUNTRY_NAMES.find(({ name }) => seg.endsWith(name));
  if (!hit) return;
  const before = seg.slice(0, seg.length - hit.name.length);
  if (!before || /[\s\d]$/.test(before) || /(?:^|\s)[a-z0-9]*\d[a-z0-9]*$/.test(before)) {
    out.add(hit.code);
  }
}

/** 去掉郵遞區號與數字：拉丁字母＋數字的詞整個去掉（例：SE16、7AR），CJK 詞只去數字。 */
function cleanSegment(seg: string): string {
  return seg
    .replace(/〒/g, " ")
    .split(/\s+/)
    .map((tok) => {
      if (!/\d/.test(tok)) return tok;
      if (/^[\p{Script=Latin}\d\p{P}]+$/u.test(tok)) return "";
      return tok.replace(/[\d\-−–]+/g, "");
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
    .trim();
}

function addressSegments(norm: string): string[] {
  return norm.split(SEGMENT_SPLIT).map(cleanSegment).filter(Boolean);
}

/**
 * 地址邊緣段的明確國名：第一段或最後一段「整段等於」國名，或 CJK 地址開頭的國名前綴。
 * 地址中間的 Little India、China Town、인도、中国自動車道 一律不算；州碼（FL、ON）也不算。
 */
function explicitCountries(norm: string): Set<string> {
  const out = new Set<string>();
  if (!norm.trim()) return out;
  addPrefixCountries(norm, out);
  const rawSegs = norm.split(SEGMENT_SPLIT).filter((s) => s.trim());
  if (rawSegs.length) addSuffixCountry(rawSegs[rawSegs.length - 1], out);
  const segs = addressSegments(norm);
  if (segs.length) {
    // 拉丁字母地址只認最後一段（只有一段時即整段），第一段不算（例：「Greece, NY」）。
    const code = COUNTRY_BY_NAME.get(segs[segs.length - 1]);
    const sar = segs.length >= 2 ? COUNTRY_BY_NAME.get(segs[segs.length - 2]) : undefined;
    // 「…, Hong Kong (SAR), China」：以倒數第二段的特別行政區為準，不算中國。
    if (code === "CN" && (sar === "HK" || sar === "MO")) out.add(sar);
    else if (code) out.add(code);
  }
  return out;
}

/** 中日文城市名可接的行政區字尾（例：台北市、東京都）。 */
const CITY_SUFFIX = /^(?:市|都|府|縣|县|特別市|特别市|特別行政區|特别行政区)$/;

/**
 * contextCity 對應的已知城市：第一段整段等於城市名（可接行政區字尾）；
 * 有其他段時，須有明確國名且與該城市國家相同（例：「Paris, TX」不算巴黎）。
 */
function contextCityDefs(cityNorm: string): CityDef[] {
  const segs = addressSegments(cityNorm);
  if (!segs.length) return [];
  const head = segs[0];
  const matches = CITIES.filter((c) =>
    c.names.some((n) =>
      LATIN_NAME.test(n)
        ? head === n || head === `${n} city`
        : head === n || (head.startsWith(n) && CITY_SUFFIX.test(head.slice(n.length))),
    ),
  );
  if (segs.length === 1) return matches;
  const explicit = explicitCountries(cityNorm);
  return matches.filter((c) => explicit.has(c.country));
}

/** 文字中明確寫出的國家碼（只看地址邊緣段）；城市名不推國家。 */
export function countriesInGeoText(text: string | null | undefined): Set<string> {
  return explicitCountries(normalizeGeoText(text));
}

/** 文字中明確寫出的國名（地址邊緣段，中英日韓與本地寫法）；唯一可用來丟棄候選或拒絕 Details 的國家依據。 */
export function explicitCountriesInGeoText(text: string | null | undefined): Set<string> {
  return explicitCountries(normalizeGeoText(text));
}

function validCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): LatLng | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

export type PlaceGeoSource = {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  contextCity?: string | null;
  contextCountry?: string | null;
};

export type PlaceGeoContext = {
  /** 地點自身地址邊緣段的明確國名；自身無地址、無座標時為 context 國家（排序用） */
  countries: Set<string>;
  /** 地點自身地址邊緣段「明確寫出」的國名（唯一可丟棄候選的依據） */
  ownCountries: Set<string>;
  /** 地點自身座標（硬訊號，可判 mismatch） */
  coords: LatLng | null;
  /** contextCountry／contextCity（城市表內）的國家碼（排序 ± 與 Details 錨點） */
  softCountries: Set<string>;
  /** 排序 ± 用的 context 國家：contextCity 在城市表內時為其國家，否則為 contextCountry */
  rankCountries: Set<string>;
  /** rankCountries 不符時是否扣分（contextCity 與 contextCountry 國家不一致時為 false） */
  rankPenalty: boolean;
  /** contextCity（城市表內）的所有名稱與別名（候選分段整段比對加分用） */
  cityNames: string[];
  /** 靜態表查不到的 contextCity 原文（正規化後；軟訊號，只加分排序） */
  cityTerms: string[];
  /** 無座標時給 Autocomplete 的偏好中心（靜態表） */
  center: LatLng | null;
};

function countriesFromCountryText(raw: string): Set<string> {
  const text = raw.trim();
  if (/^[a-z]{2}$/i.test(text)) {
    const code = text.toUpperCase();
    return COUNTRY_BY_CODE.has(code) ? new Set([code]) : new Set();
  }
  return explicitCountries(normalizeGeoText(text));
}

/**
 * 地理依據只用固定資料：自身座標、自身地址邊緣段的明確國名，
 * 以及 handoff 的 contextCity（城市表內才取中心點與國家）／contextCountry。
 * 地址裡的城市名不推國家、不當錨點、不當 center。
 * 自身沒有地址、也沒有有效座標時，context 國家併入 countries（排序用）。
 */
export function buildPlaceGeoContext(source: PlaceGeoSource): PlaceGeoContext {
  const coords = validCoords(source.lat, source.lng);
  const addressNorm = normalizeGeoText(source.address);
  const ownCountries = explicitCountries(addressNorm);
  let countries = new Set(ownCountries);
  const cityNorm = normalizeGeoText(source.contextCity).trim();
  const contextCities = contextCityDefs(cityNorm);
  const softCountries = countriesFromCountryText(source.contextCountry ?? "");
  const cityCountries = explicitCountries(cityNorm);
  for (const c of contextCities) cityCountries.add(c.country);
  // 排序 ± 優先用 contextCity（延伸點為延伸目的地）的國家；不在城市表內才用 contextCountry。
  // 兩者國家不一致時（同名城市可能在不同國家，例：Vancouver WA／BC）取聯集，只加分、不扣分。
  const rankConflict =
    cityCountries.size > 0 &&
    softCountries.size > 0 &&
    ![...cityCountries].some((c) => softCountries.has(c));
  const rankCountries = !cityCountries.size
    ? new Set(softCountries)
    : rankConflict
      ? new Set([...cityCountries, ...softCountries])
      : new Set(cityCountries);
  for (const code of cityCountries) softCountries.add(code);
  if (!addressNorm.trim() && !coords && rankCountries.size && !rankConflict) {
    countries = new Set(rankCountries);
  }
  const cityTerms = cityNorm && !cityCountries.size && cityNorm.length >= 2 ? [cityNorm] : [];

  const center = coords ?? contextCities[0]?.center ?? null;
  return {
    countries,
    ownCountries,
    coords,
    softCountries,
    rankCountries,
    rankPenalty: !rankConflict,
    cityNames: [...new Set(contextCities.flatMap((c) => c.names))],
    cityTerms,
    center,
  };
}

/** 候選某一段整段等於 contextCity（城市表內）的名稱或別名；只做文字比對，不推國家。 */
function hasContextCitySegment(ctx: PlaceGeoContext, norm: string): boolean {
  if (!ctx.cityNames.length) return false;
  return addressSegments(norm).some((seg) => ctx.cityNames.includes(seg));
}

/**
 * 名稱解析唯一的丟棄條件：地點自身地址文字的國家與候選文字的國家明確不同（文字對文字）。
 * context 國家、座標推出的國家只影響排序，不丟棄。
 */
export function isCandidateOwnAddressCountryMismatch(
  ctx: PlaceGeoContext,
  candidateText: string | null | undefined,
): boolean {
  if (!ctx.ownCountries.size) return false;
  const cand = explicitCountriesInGeoText(candidateText);
  return cand.size > 0 && ![...cand].some((c) => ctx.ownCountries.has(c));
}

/** 是否有可供 Details 防線判斷的固定資料（自身地址國名、自身座標或 context 國家）。 */
export function hasHardPlaceGeoContext(ctx: PlaceGeoContext): boolean {
  return ctx.countries.size > 0 || ctx.coords != null || ctx.softCountries.size > 0;
}

export function hasPlaceGeoContext(ctx: PlaceGeoContext): boolean {
  return hasHardPlaceGeoContext(ctx) || ctx.softCountries.size > 0 || ctx.cityTerms.length > 0;
}

/** 是否有文字地理脈絡（地址／城市／國家）；不含只有座標的情況。 */
export function hasTextualPlaceGeoContext(ctx: PlaceGeoContext): boolean {
  return ctx.countries.size > 0 || ctx.softCountries.size > 0 || ctx.cityTerms.length > 0;
}

/** 候選是否符合軟訊號（contextCity／contextCountry）；只用於加分排序。 */
export function matchesSoftPlaceGeoContext(
  ctx: PlaceGeoContext,
  candidateText: string | null | undefined,
): boolean {
  const norm = normalizeGeoText(candidateText);
  if (!norm) return false;
  if (ctx.cityTerms.some((t) => norm.includes(t))) return true;
  if (hasContextCitySegment(ctx, norm)) return true;
  // 國家不一致（聯集）時，國家只用來免扣分；加分改由上面的城市名分段比對決定。
  if (!ctx.rankCountries.size || !ctx.rankPenalty) return false;
  return [...countriesInGeoText(norm)].some((c) => ctx.rankCountries.has(c));
}

export type PlaceGeoVerdict = "match" | "mismatch" | "unknown";

/**
 * 比對候選（Autocomplete secondary）與地點的地理脈絡，結果只用於排序加減分；
 * 丟棄候選請用 isCandidateOwnAddressCountryMismatch。
 * 座標只在「推得出國家」時參與；推不出（太遠／邊界模糊）視為 unknown。
 */
export function judgeCandidateGeo(
  ctx: PlaceGeoContext,
  candidateText: string | null | undefined,
  candidateCoords?: LatLng | null,
): PlaceGeoVerdict {
  const norm = normalizeGeoText(candidateText);
  const candCountries = countriesInGeoText(norm);

  // 文字優先：雙方文字都看得出國家時以文字為準，座標推出的國家不得覆蓋。
  if (ctx.countries.size && candCountries.size) {
    return [...candCountries].some((c) => ctx.countries.has(c)) ? "match" : "mismatch";
  }
  // 地點自身只有座標、候選文字看得出國家：座標推得出（保守）才比對。
  if (ctx.coords && candCountries.size) {
    const code = countryFromCoords(ctx.coords);
    if (code) return candCountries.has(code) ? "match" : "mismatch";
  }
  // 候選文字看不出國家、只有候選座標：座標推得出（保守）才比對。
  if (candidateCoords && ctx.countries.size && !candCountries.size) {
    const code = countryFromCoords(candidateCoords);
    if (code) return ctx.countries.has(code) ? "match" : "mismatch";
  }
  // 其餘：context 國家（contextCity 城市表優先，否則 contextCountry）與候選邊緣段國名比對。
  if (ctx.rankCountries.size && candCountries.size) {
    // 國家不一致（聯集）時不加分、不扣分；加分只看 contextCity 分段比對（matchesSoftPlaceGeoContext）。
    if (!ctx.rankPenalty) return "unknown";
    return [...candCountries].some((c) => ctx.rankCountries.has(c)) ? "match" : "mismatch";
  }
  return "unknown";
}

/**
 * 座標所在國家碼（保守的最近已知城市中心點判斷，條件見 countryFromCoords）。
 * 推不出或座標無效時回傳 null。
 */
export function countryCodeForCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | null {
  const p = validCoords(lat, lng);
  return p ? countryFromCoords(p) : null;
}

/** 國家文字（國名或 ISO 兩碼）只對應到單一國家時回傳該國家碼；否則 null。 */
export function countryCodeFromCountryText(text: string | null | undefined): string | null {
  const raw = text?.trim() ?? "";
  if (!raw) return null;
  if (/^[a-z]{2}$/i.test(raw)) {
    const code = raw.toUpperCase();
    return COUNTRY_BY_CODE.has(code) ? code : null;
  }
  const codes = countriesInGeoText(raw);
  return codes.size === 1 ? [...codes][0] : null;
}

/**
 * 只依「地址文字」剔除明確屬於其他國家的地點；地址看不出國家（unknown）一律保留。
 * 目的地國家無法辨識時原樣回傳。
 */
export function filterPlacesByCountryAddress<T extends { address?: string | null }>(
  places: readonly T[],
  destinationCountry: string | null | undefined,
): T[] {
  // 目的地國家在這裡是呼叫端明確指定的篩選條件；地點地址只認明確國名（城市推得的不算）。
  const countries = countriesFromCountryText(destinationCountry ?? "");
  if (!countries.size) return [...places];
  return places.filter((p) => {
    const found = explicitCountriesInGeoText(p.address);
    return !found.size || [...found].some((c) => countries.has(c));
  });
}

/** Details 座標與 handoff 座標相差超過此距離視為不同地點（容許行程點用區域中心座標）。 */
export const RESOLVED_PLACE_MAX_DISTANCE_KM = 300;

/**
 * 只有 context（行程目的地／收藏城市）時，Details 座標與參考點的距離上限（且國家不符才拒絕）。
 * 行程點可能是目的地周邊的一日／延伸行程（如雪梨→藍山、東京→日光、大阪→廣島約 280 km），
 * 比自身座標的 300 km 再寬一些；跨國同名（雪梨↔烏蘭巴托約 9,000 km）仍遠超過。
 */
export const RESOLVED_CONTEXT_CITY_MAX_DISTANCE_KM = 400;

/**
 * Details 完全沒有國名、只有座標時的距離上限：超過且保守座標推得的國家與參考國家不同才拒絕。
 * 距離是對「參考國家的所有已知地點」計算（例：雪梨行程抓回伯斯，伯斯本身就是澳洲已知地點，
 * 距離為 0），所以同國遠距地點不會因 2000 km 被擋；座標推不出國家時一律接受。
 */
export const RESOLVED_NO_COUNTRY_MAX_DISTANCE_KM = 2000;

function minDistanceMeters(p: LatLng, centers: readonly LatLng[]): number {
  let min = Infinity;
  for (const c of centers) min = Math.min(min, distanceMeters(p, c));
  return min;
}

function anchorsForCountries(countries: ReadonlySet<string>): LatLng[] {
  return COORD_ANCHORS.filter((a) => countries.has(a.country)).map((a) => a.center);
}

/**
 * Details 抓回、合併前的防護：以名稱解析得到的 placeId 抓回的地點，
 * 必須與 handoff 自身的地址／座標一致，否則不得覆蓋原本的名稱／地址／照片。
 * 只有「確定」時才拒絕（國家只認地址邊緣段的明確國名；城市名不推國家、不當錨點）：
 * a. 自身座標與 Details 座標相距超過 300 km。
 * b. 自身地址與 Details 地址邊緣段都有明確國名且不同。
 * c. 自身無座標時，以錨點判斷：參考國為自身地址邊緣段國名，地址沒寫國名時為 context 國家；
 *    錨點為 contextCity（城市表內）中心與參考國／context 國家的所有已知地點。
 *    - Details 明確寫出國名：與參考國家不同、且距所有錨點超過 400 km 才拒絕。
 *    - Details 沒有國名、只有座標：距所有錨點超過 2000 km、且保守座標推得的國家與參考國家
 *      不同才拒絕；推不出國家則接受。
 * Details 沒回座標時只做 b。判斷不出時一律接受。
 */
export function isResolvedPlaceGeoConsistent(
  source: PlaceGeoSource,
  fetched: { lat?: number | null; lng?: number | null; address?: string | null },
): boolean {
  const ctx = buildPlaceGeoContext(source);
  if (!hasHardPlaceGeoContext(ctx)) return true;
  const fetchedCoords = validCoords(fetched.lat, fetched.lng);
  const fetchedExplicit = explicitCountriesInGeoText(fetched.address);
  // a. 自身座標 vs Details 座標
  if (ctx.coords && fetchedCoords) {
    if (distanceMeters(ctx.coords, fetchedCoords) > RESOLVED_PLACE_MAX_DISTANCE_KM * 1000) {
      return false;
    }
  }
  // b. 自身地址明確國名 vs Details 地址明確國名
  if (ctx.ownCountries.size && fetchedExplicit.size) {
    if (![...fetchedExplicit].some((c) => ctx.ownCountries.has(c))) return false;
  }
  if (ctx.coords || !fetchedCoords) return true;

  // c. 錨點判斷：參考國為自身地址邊緣段國名；地址沒寫國名時為 context 國家。城市名不當錨點。
  const refCountries = ctx.ownCountries.size ? ctx.ownCountries : ctx.softCountries;
  if (!refCountries.size) return true;
  const allowed = new Set([...ctx.ownCountries, ...ctx.softCountries]);
  const contextCities = contextCityDefs(normalizeGeoText(source.contextCity).trim());
  const centers = [...contextCities.map((c) => c.center), ...anchorsForCountries(allowed)];
  const distance = minDistanceMeters(fetchedCoords, centers);
  if (fetchedExplicit.size) {
    if ([...fetchedExplicit].some((c) => refCountries.has(c))) return true;
    return distance <= RESOLVED_CONTEXT_CITY_MAX_DISTANCE_KM * 1000;
  }
  if (distance <= RESOLVED_NO_COUNTRY_MAX_DISTANCE_KM * 1000) return true;
  const inferred = countryFromCoords(fetchedCoords);
  return !inferred || allowed.has(inferred);
}
