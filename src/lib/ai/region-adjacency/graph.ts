/**
 * Nearby Region knowledge graph — DATA only, not flow branching.
 *
 * Hierarchy (metro / living circle / tourist zone) is the primary Near Region
 * gate; travel time only ranks candidates that already pass hierarchy.
 */
import type { NearbyRegionTier } from "@/lib/ai/region-adjacency/types";

/**
 * Region hierarchy — Near Region must share metro, living circle, or admin,
 * and must not be a separate major tourist region.
 */
export type RegionHierarchy = {
  /** Metropolitan area id (e.g. tokyo_metro, keihanshin, chukyo) */
  metroArea: string;
  /** Day-to-day living circle; often equals metro, may be narrower */
  livingCircle: string;
  /**
   * Major tourist-area bucket. Distinct resort / pilgrimage zones stay out of
   * default nearby even when transit time looks acceptable.
   */
  touristZone: string;
  /**
   * Dedicated resort / pilgrimage / remote sightseeing destination.
   * Never default-nearby unless user asks / deep travel / confirm.
   */
  separateTouristRegion?: boolean;
};

export type RegionNode = {
  /** Canonical id (= primary display label) */
  id: string;
  aliases?: string[];
  countryCode: string;
  adminArea?: string;
  center?: { lat: number; lng: number };
  hierarchy: RegionHierarchy;
};

export type RegionEdge = {
  a: string;
  b: string;
  tier: NearbyRegionTier;
  /** Typical one-way transit minutes when known */
  typicalTravelMinutes?: number;
};

/**
 * Region nodes used for adjacency + distance fallback.
 * Keep centers approximate; geocode remains source of truth at runtime.
 */
export const REGION_NODES: readonly RegionNode[] = [
  // ── Japan · Tokyo metro ──
  {
    id: "東京",
    aliases: ["Tokyo", "東京都"],
    countryCode: "JP",
    adminArea: "東京都",
    center: { lat: 35.6762, lng: 139.6503 },
    hierarchy: {
      metroArea: "tokyo_metro",
      livingCircle: "tokyo_living",
      touristZone: "tokyo_urban",
    },
  },
  {
    id: "橫濱",
    aliases: ["横浜", "Yokohama"],
    countryCode: "JP",
    adminArea: "神奈川県",
    center: { lat: 35.4437, lng: 139.638 },
    hierarchy: {
      metroArea: "tokyo_metro",
      livingCircle: "tokyo_living",
      touristZone: "tokyo_urban",
    },
  },
  {
    id: "川崎",
    aliases: ["Kawasaki"],
    countryCode: "JP",
    adminArea: "神奈川県",
    center: { lat: 35.5308, lng: 139.7029 },
    hierarchy: {
      metroArea: "tokyo_metro",
      livingCircle: "tokyo_living",
      touristZone: "tokyo_urban",
    },
  },
  {
    id: "千葉",
    aliases: ["Chiba"],
    countryCode: "JP",
    adminArea: "千葉県",
    center: { lat: 35.6074, lng: 140.1065 },
    hierarchy: {
      metroArea: "tokyo_metro",
      livingCircle: "tokyo_living",
      touristZone: "tokyo_urban",
    },
  },
  {
    id: "埼玉",
    aliases: ["Saitama", "大宮"],
    countryCode: "JP",
    adminArea: "埼玉県",
    center: { lat: 35.8617, lng: 139.6455 },
    hierarchy: {
      metroArea: "tokyo_metro",
      livingCircle: "tokyo_living",
      touristZone: "tokyo_urban",
    },
  },
  {
    id: "鎌倉",
    aliases: ["Kamakura"],
    countryCode: "JP",
    adminArea: "神奈川県",
    center: { lat: 35.319, lng: 139.5467 },
    hierarchy: {
      metroArea: "tokyo_metro",
      livingCircle: "tokyo_living",
      touristZone: "tokyo_urban",
    },
  },
  {
    id: "箱根",
    aliases: ["Hakone"],
    countryCode: "JP",
    adminArea: "神奈川県",
    center: { lat: 35.2324, lng: 139.1069 },
    hierarchy: {
      metroArea: "kanto_onsen",
      livingCircle: "hakone_resort",
      touristZone: "hakone_resort",
      separateTouristRegion: true,
    },
  },
  // ── Japan · Keihanshin ──
  {
    id: "大阪",
    aliases: ["Osaka", "大阪府"],
    countryCode: "JP",
    adminArea: "大阪府",
    center: { lat: 34.6937, lng: 135.5023 },
    hierarchy: {
      metroArea: "keihanshin",
      livingCircle: "keihanshin_living",
      touristZone: "kansai_urban",
    },
  },
  {
    id: "京都",
    aliases: ["Kyoto", "京都府"],
    countryCode: "JP",
    adminArea: "京都府",
    center: { lat: 35.0116, lng: 135.7681 },
    hierarchy: {
      metroArea: "keihanshin",
      livingCircle: "keihanshin_living",
      touristZone: "kansai_urban",
    },
  },
  {
    id: "神戶",
    aliases: ["神戸", "Kobe"],
    countryCode: "JP",
    adminArea: "兵庫県",
    center: { lat: 34.6901, lng: 135.1955 },
    hierarchy: {
      metroArea: "keihanshin",
      livingCircle: "keihanshin_living",
      touristZone: "kansai_urban",
    },
  },
  {
    id: "奈良",
    aliases: ["Nara"],
    countryCode: "JP",
    adminArea: "奈良県",
    center: { lat: 34.6851, lng: 135.8048 },
    hierarchy: {
      metroArea: "keihanshin",
      livingCircle: "keihanshin_living",
      touristZone: "kansai_urban",
    },
  },
  {
    id: "宇治",
    aliases: ["Uji"],
    countryCode: "JP",
    adminArea: "京都府",
    center: { lat: 34.8844, lng: 135.7998 },
    hierarchy: {
      metroArea: "keihanshin",
      livingCircle: "keihanshin_living",
      touristZone: "kansai_urban",
    },
  },
  {
    id: "白濱",
    aliases: ["白浜", "Shirahama"],
    countryCode: "JP",
    adminArea: "和歌山県",
    center: { lat: 33.6781, lng: 135.3344 },
    hierarchy: {
      metroArea: "wakayama_south",
      livingCircle: "shirahama_coast",
      touristZone: "shirahama_coast",
      separateTouristRegion: true,
    },
  },
  // ── Japan · Chukyo (Nagoya) ──
  {
    id: "名古屋",
    aliases: ["Nagoya", "愛知"],
    countryCode: "JP",
    adminArea: "愛知県",
    center: { lat: 35.1815, lng: 136.9066 },
    hierarchy: {
      metroArea: "chukyo",
      livingCircle: "chukyo_living",
      touristZone: "chukyo_urban",
    },
  },
  {
    id: "犬山",
    aliases: ["Inuyama", "犬山城"],
    countryCode: "JP",
    adminArea: "愛知県",
    center: { lat: 35.3881, lng: 136.9447 },
    hierarchy: {
      metroArea: "chukyo",
      livingCircle: "chukyo_living",
      touristZone: "chukyo_urban",
    },
  },
  {
    id: "常滑",
    aliases: ["Tokoname"],
    countryCode: "JP",
    adminArea: "愛知県",
    center: { lat: 34.8866, lng: 136.8324 },
    hierarchy: {
      metroArea: "chukyo",
      livingCircle: "chukyo_living",
      touristZone: "chukyo_urban",
    },
  },
  {
    id: "瀨戶",
    aliases: ["瀬戸", "Seto"],
    countryCode: "JP",
    adminArea: "愛知県",
    center: { lat: 35.2236, lng: 137.0842 },
    hierarchy: {
      metroArea: "chukyo",
      livingCircle: "chukyo_living",
      touristZone: "chukyo_urban",
    },
  },
  {
    id: "岡崎",
    aliases: ["Okazaki"],
    countryCode: "JP",
    adminArea: "愛知県",
    center: { lat: 34.9543, lng: 137.1744 },
    hierarchy: {
      metroArea: "chukyo",
      livingCircle: "chukyo_living",
      touristZone: "chukyo_urban",
    },
  },
  {
    id: "一宮",
    aliases: ["Ichinomiya"],
    countryCode: "JP",
    adminArea: "愛知県",
    center: { lat: 35.304, lng: 136.803 },
    hierarchy: {
      metroArea: "chukyo",
      livingCircle: "chukyo_living",
      touristZone: "chukyo_urban",
    },
  },
  {
    id: "岐阜",
    aliases: ["岐阜市", "Gifu"],
    countryCode: "JP",
    adminArea: "岐阜県",
    center: { lat: 35.4232, lng: 136.7606 },
    hierarchy: {
      metroArea: "chukyo",
      livingCircle: "chukyo_living",
      touristZone: "chukyo_urban",
    },
  },
  {
    id: "伊勢",
    aliases: ["Ise", "伊勢神宮"],
    countryCode: "JP",
    adminArea: "三重県",
    center: { lat: 34.4875, lng: 136.7092 },
    hierarchy: {
      metroArea: "ise_shima",
      livingCircle: "ise_shima",
      touristZone: "ise_shima",
      separateTouristRegion: true,
    },
  },
  {
    id: "合掌造",
    aliases: ["合掌造集落", "白川鄉", "白川郷", "Shirakawa"],
    countryCode: "JP",
    adminArea: "岐阜県",
    center: { lat: 36.2577, lng: 136.9063 },
    hierarchy: {
      metroArea: "hida_shirakawa",
      livingCircle: "hida_shirakawa",
      touristZone: "hida_shirakawa",
      separateTouristRegion: true,
    },
  },
  // ── Taiwan ──
  {
    id: "台北",
    aliases: ["臺北", "Taipei"],
    countryCode: "TW",
    adminArea: "台北市",
    center: { lat: 25.033, lng: 121.5654 },
    hierarchy: {
      metroArea: "taipei_metro",
      livingCircle: "taipei_living",
      touristZone: "taipei_urban",
    },
  },
  {
    id: "新北",
    aliases: ["新北市", "New Taipei"],
    countryCode: "TW",
    adminArea: "新北市",
    center: { lat: 25.0169, lng: 121.4628 },
    hierarchy: {
      metroArea: "taipei_metro",
      livingCircle: "taipei_living",
      touristZone: "taipei_urban",
    },
  },
  {
    id: "基隆",
    aliases: ["Keelung"],
    countryCode: "TW",
    adminArea: "基隆市",
    center: { lat: 25.1276, lng: 121.7395 },
    hierarchy: {
      metroArea: "taipei_metro",
      livingCircle: "taipei_living",
      touristZone: "taipei_urban",
    },
  },
  {
    id: "桃園",
    aliases: ["Taoyuan"],
    countryCode: "TW",
    adminArea: "桃園市",
    center: { lat: 24.9936, lng: 121.301 },
    hierarchy: {
      metroArea: "taipei_metro",
      livingCircle: "taipei_living",
      touristZone: "taipei_urban",
    },
  },
  {
    id: "台中",
    aliases: ["臺中", "Taichung"],
    countryCode: "TW",
    adminArea: "台中市",
    center: { lat: 24.1477, lng: 120.6736 },
    hierarchy: {
      metroArea: "taichung_metro",
      livingCircle: "taichung_living",
      touristZone: "taichung_urban",
    },
  },
  {
    id: "彰化",
    aliases: ["Changhua"],
    countryCode: "TW",
    adminArea: "彰化縣",
    center: { lat: 24.08, lng: 120.54 },
    hierarchy: {
      metroArea: "taichung_metro",
      livingCircle: "taichung_living",
      touristZone: "taichung_urban",
    },
  },
  {
    id: "南投",
    aliases: ["Nantou"],
    countryCode: "TW",
    adminArea: "南投縣",
    center: { lat: 23.9609, lng: 120.9718 },
    hierarchy: {
      metroArea: "taichung_metro",
      livingCircle: "taichung_living",
      touristZone: "taichung_urban",
    },
  },
  // ── Korea ──
  {
    id: "首爾",
    aliases: ["서울", "Seoul"],
    countryCode: "KR",
    adminArea: "서울",
    center: { lat: 37.5665, lng: 126.978 },
    hierarchy: {
      metroArea: "seoul_metro",
      livingCircle: "seoul_living",
      touristZone: "seoul_urban",
    },
  },
  {
    id: "仁川",
    aliases: ["Incheon", "인천"],
    countryCode: "KR",
    adminArea: "인천",
    center: { lat: 37.4563, lng: 126.7052 },
    hierarchy: {
      metroArea: "seoul_metro",
      livingCircle: "seoul_living",
      touristZone: "seoul_urban",
    },
  },
  {
    id: "水原",
    aliases: ["Suwon", "수원", "水原華城"],
    countryCode: "KR",
    adminArea: "경기도",
    center: { lat: 37.2636, lng: 127.0286 },
    hierarchy: {
      metroArea: "seoul_metro",
      livingCircle: "seoul_living",
      touristZone: "seoul_urban",
    },
  },
  {
    id: "城南",
    aliases: ["Seongnam", "성남"],
    countryCode: "KR",
    adminArea: "경기도",
    center: { lat: 37.4201, lng: 127.1262 },
    hierarchy: {
      metroArea: "seoul_metro",
      livingCircle: "seoul_living",
      touristZone: "seoul_urban",
    },
  },
  {
    id: "坡州",
    aliases: ["Paju", "파주"],
    countryCode: "KR",
    adminArea: "경기도",
    center: { lat: 37.7599, lng: 126.775 },
    hierarchy: {
      metroArea: "seoul_metro",
      livingCircle: "seoul_living",
      touristZone: "seoul_urban",
    },
  },
  {
    id: "南怡島",
    aliases: ["Nami Island", "남이섬"],
    countryCode: "KR",
    adminArea: "강원도",
    center: { lat: 37.7901, lng: 127.525 },
    hierarchy: {
      metroArea: "gangwon_resort",
      livingCircle: "nami_resort",
      touristZone: "nami_resort",
      separateTouristRegion: true,
    },
  },
  // ── Thailand / Europe samples ──
  {
    id: "曼谷",
    aliases: ["Bangkok"],
    countryCode: "TH",
    adminArea: "Bangkok",
    center: { lat: 13.7563, lng: 100.5018 },
    hierarchy: {
      metroArea: "bangkok_metro",
      livingCircle: "bangkok_living",
      touristZone: "bangkok_urban",
    },
  },
  {
    id: "大城",
    aliases: ["Ayutthaya"],
    countryCode: "TH",
    adminArea: "Ayutthaya",
    center: { lat: 14.3692, lng: 100.5877 },
    hierarchy: {
      metroArea: "ayutthaya",
      livingCircle: "ayutthaya",
      touristZone: "ayutthaya",
      separateTouristRegion: true,
    },
  },
  {
    id: "巴黎",
    aliases: ["Paris"],
    countryCode: "FR",
    adminArea: "Île-de-France",
    center: { lat: 48.8566, lng: 2.3522 },
    hierarchy: {
      metroArea: "paris_metro",
      livingCircle: "paris_living",
      touristZone: "paris_urban",
    },
  },
  {
    id: "凡爾賽",
    aliases: ["Versailles", "凡爾賽宮"],
    countryCode: "FR",
    adminArea: "Île-de-France",
    center: { lat: 48.8049, lng: 2.1204 },
    hierarchy: {
      metroArea: "paris_metro",
      livingCircle: "paris_living",
      touristZone: "paris_urban",
    },
  },
];

/**
 * Undirected adjacency edges. Prefer adjacent / living_circle for defaults;
 * mark separate tourist regions as farther (hierarchy still hard-gates).
 */
export const REGION_EDGES: readonly RegionEdge[] = [
  // Tokyo metro
  { a: "東京", b: "橫濱", tier: "adjacent", typicalTravelMinutes: 35 },
  { a: "東京", b: "川崎", tier: "adjacent", typicalTravelMinutes: 25 },
  { a: "東京", b: "千葉", tier: "adjacent", typicalTravelMinutes: 40 },
  { a: "東京", b: "埼玉", tier: "adjacent", typicalTravelMinutes: 35 },
  { a: "東京", b: "鎌倉", tier: "living_circle", typicalTravelMinutes: 55 },
  { a: "東京", b: "箱根", tier: "farther", typicalTravelMinutes: 100 },
  // Kansai
  { a: "大阪", b: "京都", tier: "living_circle", typicalTravelMinutes: 30 },
  { a: "大阪", b: "神戶", tier: "adjacent", typicalTravelMinutes: 30 },
  { a: "大阪", b: "奈良", tier: "living_circle", typicalTravelMinutes: 45 },
  { a: "大阪", b: "白濱", tier: "farther", typicalTravelMinutes: 150 },
  { a: "京都", b: "宇治", tier: "adjacent", typicalTravelMinutes: 25 },
  { a: "京都", b: "奈良", tier: "living_circle", typicalTravelMinutes: 45 },
  { a: "京都", b: "大阪", tier: "living_circle", typicalTravelMinutes: 30 },
  // Nagoya / Chukyo — NOT Ise / Shirakawa by default
  { a: "名古屋", b: "犬山", tier: "adjacent", typicalTravelMinutes: 35 },
  { a: "名古屋", b: "常滑", tier: "living_circle", typicalTravelMinutes: 40 },
  { a: "名古屋", b: "瀨戶", tier: "adjacent", typicalTravelMinutes: 35 },
  { a: "名古屋", b: "岡崎", tier: "living_circle", typicalTravelMinutes: 45 },
  { a: "名古屋", b: "一宮", tier: "adjacent", typicalTravelMinutes: 25 },
  { a: "名古屋", b: "岐阜", tier: "living_circle", typicalTravelMinutes: 30 },
  { a: "名古屋", b: "伊勢", tier: "farther", typicalTravelMinutes: 110 },
  { a: "名古屋", b: "合掌造", tier: "farther", typicalTravelMinutes: 180 },
  // Taiwan north
  { a: "台北", b: "新北", tier: "adjacent", typicalTravelMinutes: 30 },
  { a: "台北", b: "基隆", tier: "living_circle", typicalTravelMinutes: 45 },
  { a: "台北", b: "桃園", tier: "living_circle", typicalTravelMinutes: 40 },
  { a: "台中", b: "彰化", tier: "adjacent", typicalTravelMinutes: 30 },
  { a: "台中", b: "南投", tier: "living_circle", typicalTravelMinutes: 50 },
  // Seoul metro
  { a: "首爾", b: "仁川", tier: "adjacent", typicalTravelMinutes: 45 },
  { a: "首爾", b: "水原", tier: "living_circle", typicalTravelMinutes: 40 },
  { a: "首爾", b: "城南", tier: "adjacent", typicalTravelMinutes: 35 },
  { a: "首爾", b: "坡州", tier: "popular", typicalTravelMinutes: 60 },
  { a: "首爾", b: "南怡島", tier: "farther", typicalTravelMinutes: 100 },
  // Bangkok / Paris
  { a: "曼谷", b: "大城", tier: "farther", typicalTravelMinutes: 90 },
  { a: "巴黎", b: "凡爾賽", tier: "living_circle", typicalTravelMinutes: 45 },
];
