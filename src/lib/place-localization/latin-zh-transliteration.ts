/**
 * Latin / romanized proper-noun → Traditional Chinese phonetic transliteration.
 * Destination-agnostic syllable rules for travel place names when Google/verified
 * zh names are unavailable. Not a full linguistic romanizer — confidence is capped.
 */

import { normalizePlaceNameKey } from "@/lib/place-localization/verified-place-translations";

/** High-confidence geographic / landmark tokens used worldwide. */
const KNOWN_TOKEN_ZH: Record<string, string> = {
  bagan: "蒲甘",
  phuket: "普吉",
  bangkok: "曼谷",
  chiang: "清",
  mai: "邁",
  tokyo: "東京",
  osaka: "大阪",
  kyoto: "京都",
  sapporo: "札幌",
  seoul: "首爾",
  busan: "釜山",
  jeju: "濟州",
  namsan: "南山",
  athens: "雅典",
  rome: "羅馬",
  paris: "巴黎",
  london: "倫敦",
  barcelona: "巴塞隆納",
  madrid: "馬德里",
  santorini: "聖托里尼",
  mykonos: "米克諾斯",
  bali: "峇里",
  ubud: "烏布",
  yangon: "仰光",
  mandalay: "曼德勒",
  inle: "茵萊",
  "nan myint": "南敏",
  nanmyint: "南敏",
  shwedagon: "瑞德宮",
  ananda: "阿難陀",
  thatbyinnyu: "達比努",
  dhammayangyi: "達瑪雅吉",
  shwegugyi: "瑞古意",
  manuha: "摩奴訶",
  mahabodhi: "摩訶菩提",
  sulamani: "蘇拉馬尼",
  htilominlo: "希帝樓民羅",
  gawdawpalin: "高道巴林",
  // Universal mythological / animal tokens (not destination-specific place hardcodes)
  carp: "鯉魚",
  "ca chep": "鯉魚",
  cachep: "鯉魚",
  dragon: "龍",
  rong: "龍",
  "hoa rong": "化龍",
  hoarong: "化龍",
};

/** Digraph / trigraph onsets (longest first). */
const ONSETS: Array<[string, string]> = [
  ["nyaung", "良"],
  ["nyoung", "良"],
  ["nyung", "良"],
  ["nya", "尼亞"],
  ["nyo", "尼奧"],
  ["nyu", "紐"],
  ["ng", "恩"],
  ["ny", "尼"],
  ["th", "特"],
  ["ph", "普"],
  ["kh", "克"],
  ["gh", "格"],
  ["ch", "奇"],
  ["sh", "希"],
  ["zh", "支"],
  ["ts", "茨"],
  ["dz", "茲"],
  ["kw", "誇"],
  ["qu", "庫"],
  ["wh", "瓦"],
];

const SINGLE_ONSET: Record<string, string> = {
  b: "布",
  c: "克",
  d: "德",
  f: "夫",
  g: "格",
  h: "赫",
  j: "傑",
  k: "克",
  l: "拉",
  m: "敏",
  n: "納",
  p: "佩",
  q: "庫",
  r: "爾",
  s: "斯",
  t: "特",
  v: "夫",
  w: "瓦",
  x: "克斯",
  y: "亞",
  z: "茲",
};

const VOWELS: Array<[string, string]> = [
  ["ough", "歐"],
  ["augh", "奧"],
  ["ee", "伊"],
  ["oo", "烏"],
  ["ou", "歐"],
  ["au", "奧"],
  ["aw", "奧"],
  ["ai", "艾"],
  ["ay", "艾"],
  ["ei", "艾"],
  ["ey", "艾"],
  ["oi", "歐伊"],
  ["oy", "歐伊"],
  ["ue", "烏埃"],
  ["ui", "烏伊"],
  ["ie", "耶"],
  ["ea", "伊阿"],
  ["oa", "歐阿"],
  ["io", "約"],
  ["ia", "亞"],
  ["iu", "尤"],
  ["a", "阿"],
  ["e", "埃"],
  ["i", "伊"],
  ["o", "歐"],
  ["u", "烏"],
  ["y", "伊"],
];

const MAX_TRANSLITERATION_CONFIDENCE = 0.86;

function transliterateToken(raw: string): string {
  const key = normalizePlaceNameKey(raw).replace(/[^a-z0-9\-]/g, "");
  if (!key) return "";
  const known = KNOWN_TOKEN_ZH[key];
  if (known) return known;

  // Multi-word known (e.g. nan myint) handled by caller; compound without spaces:
  for (const [en, zh] of Object.entries(KNOWN_TOKEN_ZH)) {
    if (en.includes(" ")) continue;
    if (key === en) return zh;
  }

  let rest = key;
  let out = "";
  while (rest.length > 0) {
    let matched = false;
    for (const [en, zh] of ONSETS) {
      if (rest.startsWith(en)) {
        out += zh;
        rest = rest.slice(en.length);
        // Attach following vowel nucleus if present
        for (const [v, vz] of VOWELS) {
          if (rest.startsWith(v)) {
            // Onset already carries sound; append vowel only when onset is short consonant.
            if (en.length <= 2) out = out.slice(0, -zh.length) + mergeOnsetVowel(zh, vz);
            else out += ""; // long onset maps already include vowel-ish quality
            // For long onsets like nyaung, swallow trailing vowels already in onset map.
            if (en.length > 2) {
              // nyaung already complete
            } else {
              rest = rest.slice(v.length);
            }
            break;
          }
        }
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const ch = rest[0]!;
    if (/[aeiouy]/.test(ch)) {
      for (const [v, vz] of VOWELS) {
        if (rest.startsWith(v)) {
          out += vz;
          rest = rest.slice(v.length);
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }

    const onsetZh = SINGLE_ONSET[ch];
    if (onsetZh) {
      rest = rest.slice(1);
      let vowelZh = "";
      for (const [v, vz] of VOWELS) {
        if (rest.startsWith(v)) {
          vowelZh = vz;
          rest = rest.slice(v.length);
          break;
        }
      }
      out += vowelZh ? mergeOnsetVowel(onsetZh, vowelZh) : onsetZh;
      continue;
    }

    // digit / unknown — skip
    rest = rest.slice(1);
  }
  return out;
}

/** Prefer compact common syllables (布+烏→布, 敏+阿→敏阿 kept). */
function mergeOnsetVowel(onset: string, vowel: string): string {
  // Common travel-style compact forms
  const compact: Record<string, string> = {
    布烏: "布",
    布阿: "巴",
    布埃: "貝",
    布伊: "比",
    布歐: "波",
    德烏: "杜",
    德阿: "達",
    德埃: "德",
    德伊: "迪",
    德歐: "多",
    敏烏: "穆",
    敏阿: "馬",
    敏埃: "梅",
    敏伊: "米",
    敏歐: "莫",
    納烏: "努",
    納阿: "納",
    納埃: "內",
    納伊: "尼",
    納歐: "諾",
    拉烏: "魯",
    拉阿: "拉",
    拉埃: "雷",
    拉伊: "里",
    拉歐: "羅",
    佩烏: "普",
    佩阿: "帕",
    佩埃: "佩",
    佩伊: "皮",
    佩歐: "波",
    特烏: "圖",
    特阿: "塔",
    特埃: "特",
    特伊: "提",
    特歐: "托",
    克烏: "庫",
    克阿: "卡",
    克埃: "凱",
    克伊: "基",
    克歐: "科",
    斯烏: "蘇",
    斯阿: "薩",
    斯埃: "塞",
    斯伊: "西",
    斯歐: "索",
    格烏: "古",
    格阿: "加",
    格埃: "蓋",
    格伊: "吉",
    格歐: "戈",
    赫烏: "胡",
    赫阿: "哈",
    赫埃: "黑",
    赫伊: "希",
    赫歐: "霍",
    瓦烏: "烏",
    瓦阿: "瓦",
    瓦埃: "韋",
    瓦伊: "維",
    瓦歐: "沃",
    亞烏: "尤",
    亞阿: "亞",
    亞埃: "耶",
    亞伊: "伊",
    亞歐: "約",
    傑烏: "朱",
    傑阿: "賈",
    傑埃: "傑",
    傑伊: "吉",
    傑歐: "喬",
    爾烏: "魯",
    爾阿: "拉",
    爾埃: "雷",
    爾伊: "里",
    爾歐: "羅",
    夫烏: "富",
    夫阿: "法",
    夫埃: "費",
    夫伊: "菲",
    夫歐: "福",
  };
  const key = `${onset}${vowel}`;
  return compact[key] ?? `${onset}${vowel}`;
}

/**
 * Transliterate a romanized place-name stem into Traditional Chinese characters.
 * Returns null when input is empty / already CJK / not Latin.
 */
export function transliterateLatinToZh(name: string): {
  zh: string;
  confidence: number;
  usedKnownTokens: boolean;
} | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  if (/[\u4e00-\u9fff]/.test(raw)) return null;
  if (!/[A-Za-z]/.test(raw)) return null;

  const key = normalizePlaceNameKey(raw);
  if (KNOWN_TOKEN_ZH[key]) {
    return { zh: KNOWN_TOKEN_ZH[key]!, confidence: 0.95, usedKnownTokens: true };
  }

  // Phrase-level known tokens (multi-word)
  let working = key;
  let usedKnown = false;
  const replaced: string[] = [];
  const multiKeys = Object.keys(KNOWN_TOKEN_ZH)
    .filter((k) => k.includes(" "))
    .sort((a, b) => b.length - a.length);
  for (const mk of multiKeys) {
    if (working.includes(mk)) {
      working = working.replace(mk, ` ${KNOWN_TOKEN_ZH[mk]} `);
      usedKnown = true;
    }
  }

  const parts = working.split(/[\s\-_/]+/).filter(Boolean);
  for (const part of parts) {
    if (/[\u4e00-\u9fff]/.test(part)) {
      replaced.push(part);
      continue;
    }
    const known = KNOWN_TOKEN_ZH[part];
    if (known) {
      replaced.push(known);
      usedKnown = true;
      continue;
    }
    const syl = transliterateToken(part);
    if (syl) replaced.push(syl);
  }

  const zh = replaced.join("").replace(/\s+/g, "").trim();
  if (zh.length < 2) return null;

  const confidence = usedKnown
    ? Math.min(MAX_TRANSLITERATION_CONFIDENCE + 0.06, 0.92)
    : Math.min(0.8 + Math.min(zh.length, 6) * 0.01, MAX_TRANSLITERATION_CONFIDENCE);

  return { zh, confidence, usedKnownTokens: usedKnown };
}

/** Register extra known tokens at runtime (tests / destination packs). */
export function registerLatinZhToken(latin: string, zh: string): void {
  const key = normalizePlaceNameKey(latin);
  if (!key || !zh.trim()) return;
  KNOWN_TOKEN_ZH[key] = zh.trim();
}
