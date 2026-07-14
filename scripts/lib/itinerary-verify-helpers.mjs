/** Shared fixtures for itinerary verify scripts (ChIJ real-place IDs). */

export const STYLE_OPTIONS = [
  { key: "classic_landmarks", label: "經典地標", option: 1 },
  { key: "local_life", label: "在地商圈市集走訪", option: 2 },
  { key: "slow_nature", label: "慢步調散策", option: 3 },
  { key: "mixed", label: "Roamie 混搭推薦", option: 4 },
];

export const INTEGRATION_CITIES = [
  { name: "台北", lat: 25.033, lng: 121.565, code: "TP" },
  { name: "台中", lat: 24.147, lng: 120.673, code: "TC" },
  { name: "台南", lat: 22.999, lng: 120.227, code: "TN" },
  { name: "花蓮", lat: 23.987, lng: 121.601, code: "HL" },
  { name: "台東", lat: 22.758, lng: 121.144, code: "TT" },
  { name: "東京", lat: 35.676, lng: 139.65, code: "TK" },
];

const PLACE_NAMES = {
  台中: {
    restaurant: [
      "春水堂",
      "宮原眼科",
      "第二市場牛肉麵",
      "繼光香穌餅",
      "阿季師",
      "東海雞腳",
      "王記肉圓",
      "阿水獅豬肉乾",
      "寶島鮮",
      "阿霞飯店",
      "阿多仔",
      "陳沙茶火鍋",
      "豐原肉圓",
      "麻園米糕",
      "傳統刈包",
      "阿亮雞排",
    ],
    cafe: ["CAFE 1999", "好樂日", "樂樂", "輕井澤台中", "好市多咖啡", "小日子", "Coffee Stop", "老賴咖啡", "有。咖啡", "這間咖啡"],
    attraction: [
      "彩虹眷村",
      "高美濕地",
      "國家歌劇院",
      "草悟道",
      "審計新村",
      "東海藝術街",
      "台中文化創意產業園區",
      "后里馬場",
      "大坑風景區",
      "新社花海",
      "霧峰林家",
      "921地震教育園區",
      "文心森林公園",
      "中友植物園",
      "科博館",
      "大甲鎮瀾宮",
    ],
    bar: ["Bar Mood 酒吧", "Gin Gin 酒吧", "夜間部酒吧", "Bar 9 酒吧", "Bar 168 酒吧", "夜貓子酒吧"],
    shopping: ["一中商圈", "逢甲商圈", "勤美誠品綠園道", "審計新村", "東海藝術街", "草悟道", "大坑老街", "霧峰老街"],
    market: ["第二市場商圈", "建國商圈", "台中傳統老街", "向上商圈", "英才商圈", "忠孝商圈", "黎明商圈", "樂業商圈"],
  },
  台南: {
    restaurant: [
      "度小月",
      "阿堂鹹粥",
      "周氏蝦捲",
      "安平豆花",
      "林聰明沙鍋魚頭",
      "阿松割包",
      "小杜越南河粉",
      "阿霞飯店",
      "阿美飯店",
      "阿興鮪魚",
      "阿龍香腸",
      "阿裕牛肉",
    ],
    cafe: ["正興咖啡", "窄門咖啡", "Paripari apt.", "舊時光", "小日子台南", "樂樂台南"],
    attraction: [
      "赤崁樓",
      "安平古堡",
      "奇美博物館",
      "十鼓文創園區",
      "林百貨",
      "神農街",
      "孔廟",
      "億載金城",
      "四草綠色隧道",
      "七股鹽山",
      "白河蓮花",
      "關子嶺",
    ],
    bar: ["Bar Mood 台南酒吧", "Gin Gin 台南酒吧", "夜間部台南酒吧", "Bar 9 台南酒吧", "Bar 168 台南酒吧", "夜貓子台南酒吧"],
    shopping: ["神農街", "國華街商圈", "藍晒圖", "林百貨", "赤崁商圈", "安平老街", "孔廟商圈", "海安路"],
    market: ["水仙宮商圈", "鴨母寮老街", "台南傳統老街", "赤崁商圈", "安平老街", "東門商圈", "成功商圈", "大菜市商圈"],
  },
  東京: {
    restaurant: [
      "一蘭拉麵",
      "築地壽司",
      "敘敘苑",
      "鳥貴族",
      "丸亀製麵",
      "松屋",
      "吉野家",
      "天丼てんや",
      "CoCo壱番屋",
      "大戸屋",
      "すき家",
      "やよい軒",
    ],
    cafe: ["Blue Bottle", "Starbucks Reserve", "猿田彦珈琲", "Fuglen", "Onibus", "Streamer Coffee"],
    attraction: [
      "淺草寺",
      "東京鐵塔",
      "明治神宮",
      "上野公園",
      "新宿御苑",
      "teamLab",
      "皇居",
      "六本木之丘",
      "台場",
      "原宿",
      "銀座",
      "東京晴空塔",
    ],
    bar: ["Bar High Five 酒吧", "Bar BenFiddich 酒吧", "SG Club 酒吧", "Bar Trench 酒吧", "Bar Orchard 酒吧", "Bar 168 東京酒吧"],
    shopping: ["原宿商圈", "表參道", "下北澤", "吉祥寺", "代官山", "築地場外", "阿美橫町", "仲見世通"],
    market: ["築地場外商圈", "阿美橫商店街", "錦市場商圈", "黑門市場商圈", "上野阿美橫", "吉祥寺商店街", "仲見世通", "下北澤商圈"],
  },
};

const KIND_META = {
  restaurant: { primaryType: "restaurant", types: ["restaurant", "food"] },
  cafe: { primaryType: "cafe", types: ["cafe", "coffee_shop"] },
  attraction: { primaryType: "tourist_attraction", types: ["tourist_attraction", "point_of_interest"] },
  bar: { primaryType: "bar", types: ["bar"] },
  culture: { primaryType: "museum", types: ["museum", "art_gallery"] },
  nature: { primaryType: "park", types: ["park", "natural_feature"] },
  shopping: { primaryType: "shopping_mall", types: ["shopping_mall"] },
  market: { primaryType: "market", types: ["market"] },
};

export function chijPlaceId(cityCode, kind, index) {
  const body = `${cityCode}${kind[0]}${String(index).padStart(5, "0")}abcdefghijklmnop`;
  return `ChIJ${body}`.slice(0, 27);
}

export function mockRealPlace({ name, city, lat, lng, kind, index, cityCode }) {
  const meta = KIND_META[kind] ?? KIND_META.attraction;
  const bareId = chijPlaceId(cityCode, kind, index);
  return {
    id: `places/${bareId}`,
    placeId: bareId,
    displayName: { text: name },
    formattedAddress: `${city}${name}路1號`,
    location: { latitude: lat + index * 0.001, longitude: lng + index * 0.001 },
    rating: 4.2 + (index % 5) * 0.1,
    userRatingCount: 100 + index * 17,
    primaryType: meta.primaryType,
    types: [...meta.types],
    regularOpeningHours: {
      periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        open: { day, hour: 7, minute: 0 },
        close: { day, hour: 22, minute: 0 },
      })),
      weekdayDescriptions: ["星期一: 07:00 – 22:00", "星期二: 07:00 – 22:00"],
    },
    businessStatus: "OPERATIONAL",
  };
}

/** Build a pool that passes isPlannerPoolReady for the given days. */
export function buildRealCityPool(city, days) {
  const coords = INTEGRATION_CITIES.find((c) => c.name === city.name) ?? city;
  const names = PLACE_NAMES[city.name] ?? PLACE_NAMES.台中;
  const minTotal = Math.max(1, days) * 6;
  const minDining = Math.max(1, days) * 3;
  const minScenic = Math.max(1, days) * 3;

  const out = [];
  let idx = 0;

  const pushKind = (kind, count, nameList) => {
    for (let i = 0; i < count; i += 1) {
      const cycle = Math.floor(i / nameList.length);
      const base = nameList[i % nameList.length];
      const name = cycle === 0 ? base : `${base}${cycle + 1}店`;
      out.push(
        mockRealPlace({
          name,
          city: city.name,
          lat: coords.lat,
          lng: coords.lng,
          kind,
          index: idx,
          cityCode: coords.code ?? "XX",
        }),
      );
      idx += 1;
    }
  };

  pushKind("restaurant", minDining + days, names.restaurant);
  pushKind("cafe", Math.max(2, Math.floor(minDining / 2)), names.cafe);
  pushKind("attraction", minScenic + 2, names.attraction);
  pushKind("shopping", Math.max(10, days * 3), names.shopping ?? names.attraction);
  pushKind("shopping", Math.max(8, days * 2), names.market ?? names.shopping ?? names.attraction);
  pushKind("bar", Math.max(2, days), names.bar);

  const extra = minTotal - out.length;
  if (extra > 0) {
    pushKind("attraction", extra, names.attraction);
  }

  return out;
}

export const DISALLOWED_LABELS = ["古蹟文化", "老街美食", "自然景觀", "文創咖啡", "文化", "街區", "夜市"];
export const PLACEHOLDER_RE =
  /在地午餐|在地晚餐|在地小吃|在地咖啡|在地早餐|推薦景點|placeholder|fallback/i;

export function assertNoPlaceholderNames(entries, label) {
  for (const entry of entries) {
    const name = entry.name ?? entry.place?.name ?? "";
    if (PLACEHOLDER_RE.test(name)) {
      throw new Error(`${label}: placeholder name ${name}`);
    }
    if (/^[\u4e00-\u9fff]{2,6}(在地|推薦)/.test(name) && /\d+$/.test(name)) {
      throw new Error(`${label}: synthetic name ${name}`);
    }
  }
}

export function assertAllowedLabels(entries, label) {
  const allowed = ["早餐", "景點", "午餐", "咖啡", "晚餐", "酒吧"];
  for (const entry of entries) {
    if (!allowed.includes(entry.label)) {
      throw new Error(`${label}: disallowed label ${entry.label} on ${entry.name}`);
    }
    if (DISALLOWED_LABELS.includes(entry.label)) {
      throw new Error(`${label}: theme label ${entry.label}`);
    }
  }
}

export function finishVerifyScript(failures, title) {
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed in ${title}`);
    process.exit(1);
  }
  console.log(`\nAll ${title} checks passed.`);
  process.exit(0);
}
