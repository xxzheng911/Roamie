/**
 * Normalize country labels / ISO codes from Geocode, Places, and conversation hints.
 * Shared by Destination Entity, Anchor, and Scope validation — not city-specific.
 */

import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

/** ISO-2 → canonical zh-TW country label used across RAOS destination context. */
const COUNTRY_LABEL_BY_CODE: Record<string, string> = {
  TW: "台灣",
  JP: "日本",
  KR: "韓國",
  TH: "泰國",
  CN: "中國",
  HK: "香港",
  MO: "澳門",
  ID: "印尼",
  PH: "菲律賓",
  SG: "新加坡",
  VN: "越南",
  MY: "馬來西亞",
  US: "美國",
  AU: "澳洲",
  FR: "法國",
  GB: "英國",
  UK: "英國",
  ES: "西班牙",
  IT: "義大利",
  GR: "希臘",
  CA: "加拿大",
  NZ: "紐西蘭",
  TR: "土耳其",
  MV: "馬爾地夫",
  AE: "阿拉伯聯合大公國",
  MN: "蒙古",
  EG: "埃及",
  CZ: "捷克",
  MX: "墨西哥",
  DE: "德國",
  PT: "葡萄牙",
  NL: "荷蘭",
  BE: "比利時",
  AT: "奧地利",
  CH: "瑞士",
  PL: "波蘭",
  HU: "匈牙利",
  IE: "愛爾蘭",
  IS: "冰島",
  ZA: "南非",
  BR: "巴西",
  AR: "阿根廷",
  CL: "智利",
  MA: "摩洛哥",
};

/** English / alternate spellings → canonical zh label. */
const COUNTRY_ALIASES: Record<string, string> = {
  china: "中國",
  "people's republic of china": "中國",
  prc: "中國",
  中国: "中國",
  中华人民共和国: "中國",
  中華人民共和國: "中國",
  japan: "日本",
  日本国: "日本",
  thailand: "泰國",
  泰国: "泰國",
  "south korea": "韓國",
  korea: "韓國",
  韩国: "韓國",
  "republic of korea": "韓國",
  indonesia: "印尼",
  "republic of indonesia": "印尼",
  印度尼西亞: "印尼",
  philippines: "菲律賓",
  菲律宾: "菲律賓",
  taiwan: "台灣",
  台湾: "台灣",
  "united states": "美國",
  "united states of america": "美國",
  usa: "美國",
  america: "美國",
  美国: "美國",
  australia: "澳洲",
  澳大利亚: "澳洲",
  france: "法國",
  法国: "法國",
  "united kingdom": "英國",
  england: "英國",
  britain: "英國",
  英国: "英國",
  spain: "西班牙",
  italy: "義大利",
  意大利: "義大利",
  greece: "希臘",
  希腊: "希臘",
  vietnam: "越南",
  malaysia: "馬來西亞",
  马来西亚: "馬來西亞",
  singapore: "新加坡",
  canada: "加拿大",
  "new zealand": "紐西蘭",
  新西兰: "紐西蘭",
  turkey: "土耳其",
  maldives: "馬爾地夫",
  马尔代夫: "馬爾地夫",
  mongolia: "蒙古",
  蒙古国: "蒙古",
  蒙古國: "蒙古",
  "hong kong": "香港",
  macau: "澳門",
  macao: "澳門",
  澳门: "澳門",
  egypt: "埃及",
  "arab republic of egypt": "埃及",
  czechia: "捷克",
  "czech republic": "捷克",
  捷克共和國: "捷克",
  mexico: "墨西哥",
  "united mexican states": "墨西哥",
  germany: "德國",
  德国: "德國",
  portugal: "葡萄牙",
  netherlands: "荷蘭",
  荷兰: "荷蘭",
  belgium: "比利時",
  比利时: "比利時",
  austria: "奧地利",
  奥地利: "奧地利",
  switzerland: "瑞士",
  poland: "波蘭",
  波兰: "波蘭",
  hungary: "匈牙利",
  ireland: "愛爾蘭",
  爱尔兰: "愛爾蘭",
  iceland: "冰島",
  冰岛: "冰島",
  "south africa": "南非",
  brazil: "巴西",
  argentina: "阿根廷",
  chile: "智利",
  morocco: "摩洛哥",
};

const COUNTRY_CODE_BY_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_LABEL_BY_CODE).flatMap(([code, label]) => {
    const pairs: Array<[string, string]> = [[label, code === "UK" ? "GB" : code]];
    return pairs;
  }),
);

// Extra label spellings → ISO
Object.assign(COUNTRY_CODE_BY_LABEL, {
  台湾: "TW",
  韩国: "KR",
  泰国: "TH",
  中国: "CN",
  印度尼西亞: "ID",
  菲律宾: "PH",
  美国: "US",
  澳大利亚: "AU",
  法国: "FR",
  英国: "GB",
  意大利: "IT",
  希腊: "GR",
  马来西亚: "MY",
  新西兰: "NZ",
  马尔代夫: "MV",
  澳门: "MO",
  阿聯酋: "AE",
  埃及: "EG",
  捷克: "CZ",
  墨西哥: "MX",
  德國: "DE",
  德国: "DE",
  葡萄牙: "PT",
  荷蘭: "NL",
  荷兰: "NL",
  比利時: "BE",
  比利时: "BE",
  奧地利: "AT",
  奥地利: "AT",
  瑞士: "CH",
  波蘭: "PL",
  波兰: "PL",
  匈牙利: "HU",
  愛爾蘭: "IE",
  爱尔兰: "IE",
  冰島: "IS",
  冰岛: "IS",
  南非: "ZA",
  巴西: "BR",
  阿根廷: "AR",
  智利: "CL",
  摩洛哥: "MA",
});

export function countryLabelForCode(code?: string | null): string | undefined {
  if (!code?.trim()) return undefined;
  return COUNTRY_LABEL_BY_CODE[code.trim().toUpperCase()];
}

export function countryCodeForLabel(label?: string | null): string | undefined {
  if (!label?.trim()) return undefined;
  const raw = label.trim();
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const upper = raw.toUpperCase();
    return upper === "UK" ? "GB" : upper;
  }
  const normalized = normalizeDestinationLabel(raw);
  return (
    COUNTRY_CODE_BY_LABEL[normalized] ??
    COUNTRY_CODE_BY_LABEL[raw] ??
    COUNTRY_CODE_BY_LABEL[raw.toLowerCase()]
  );
}

/**
 * Normalize any country string (zh / en / ISO) → { label, code }.
 * Used when Geocode returns "China" / "中國" / "CN".
 */
export function normalizeCountryReference(
  country?: string | null,
  countryCode?: string | null,
): { country?: string; countryCode?: string } {
  const codeFromParam = countryCode?.trim()
    ? countryCode.trim().toUpperCase() === "UK"
      ? "GB"
      : countryCode.trim().toUpperCase()
    : undefined;

  if (codeFromParam && COUNTRY_LABEL_BY_CODE[codeFromParam]) {
    return {
      country: COUNTRY_LABEL_BY_CODE[codeFromParam],
      countryCode: codeFromParam === "UK" ? "GB" : codeFromParam,
    };
  }

  if (!country?.trim()) {
    return codeFromParam ? { countryCode: codeFromParam } : {};
  }

  const raw = country.trim();
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const code = raw.toUpperCase() === "UK" ? "GB" : raw.toUpperCase();
    return {
      country: COUNTRY_LABEL_BY_CODE[code] ?? raw,
      countryCode: code,
    };
  }

  const lower = raw.toLowerCase();
  const fromAlias = COUNTRY_ALIASES[lower] ?? COUNTRY_ALIASES[normalizeDestinationLabel(raw)];
  if (fromAlias) {
    return {
      country: fromAlias,
      countryCode: countryCodeForLabel(fromAlias),
    };
  }

  const normalized = normalizeDestinationLabel(raw);
  const code = countryCodeForLabel(normalized) ?? countryCodeForLabel(raw);
  if (code) {
    return {
      country: COUNTRY_LABEL_BY_CODE[code] ?? normalized,
      countryCode: code,
    };
  }

  return { country: normalized || raw };
}

/** English country name for geocode query composition. */
export function countryEnglishName(country?: string | null): string | undefined {
  const { country: label, countryCode } = normalizeCountryReference(country);
  if (!label && !countryCode) return undefined;
  const byLabel: Record<string, string> = {
    台灣: "Taiwan",
    日本: "Japan",
    韓國: "South Korea",
    泰國: "Thailand",
    中國: "China",
    香港: "Hong Kong",
    澳門: "Macau",
    印尼: "Indonesia",
    菲律賓: "Philippines",
    新加坡: "Singapore",
    越南: "Vietnam",
    馬來西亞: "Malaysia",
    美國: "United States",
    澳洲: "Australia",
    法國: "France",
    英國: "United Kingdom",
    西班牙: "Spain",
    義大利: "Italy",
    希臘: "Greece",
    加拿大: "Canada",
    紐西蘭: "New Zealand",
    土耳其: "Turkey",
    馬爾地夫: "Maldives",
    阿拉伯聯合大公國: "United Arab Emirates",
    蒙古: "Mongolia",
  };
  if (label && byLabel[label]) return byLabel[label];
  return undefined;
}
