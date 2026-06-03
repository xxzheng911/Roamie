/** 常見目的地別名 → 共用 cache key（跨語言同一張 AI 封面） */
const DESTINATION_ALIASES: Record<string, string> = {
  busan: "busan",
  "부산": "busan",
  "釜山": "busan",
  seoul: "seoul",
  "서울": "seoul",
  "首爾": "seoul",
  tokyo: "tokyo",
  "東京": "tokyo",
  "도쿄": "tokyo",
  osaka: "osaka",
  "大阪": "osaka",
  kyoto: "kyoto",
  "京都": "kyoto",
  taipei: "taipei",
  "台北": "taipei",
  "臺北": "taipei",
  taichung: "taichung",
  "台中": "taichung",
  "臺中": "taichung",
  tainan: "tainan",
  "台南": "tainan",
  kaohsiung: "kaohsiung",
  "高雄": "kaohsiung",
  hongkong: "hong-kong",
  "香港": "hong-kong",
  singapore: "singapore",
  "新加坡": "singapore",
  bangkok: "bangkok",
  "曼谷": "bangkok",
  paris: "paris",
  "巴黎": "paris",
  london: "london",
  "倫敦": "london",
  "纽约": "new-york",
  "紐約": "new-york",
  "new york": "new-york",
  "los angeles": "los-angeles",
  "洛杉磯": "los-angeles",
  okinawa: "okinawa",
  "沖繩": "okinawa",
  "冲绳": "okinawa",
  hokkaido: "hokkaido",
  "北海道": "hokkaido",
  sapporo: "sapporo",
  "札幌": "sapporo",
};

function slugifyLatin(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 從行程目的地字串抽出主要地名（逗號、頓號、空格分隔取第一段有意義片段） */
export function extractPrimaryDestinationLabel(destination: string): string {
  const raw = destination.trim();
  if (!raw) return "";
  const parts = raw.split(/[,，、|/·\s]+/).map((p) => p.trim()).filter(Boolean);
  return parts[0] ?? raw;
}

function resolveKnownDestinationKey(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  return DESTINATION_ALIASES[trimmed] ?? DESTINATION_ALIASES[trimmed.toLowerCase()] ?? null;
}

/** 從較長字串中找出內嵌的已知城市（例：東京三日遊 → tokyo） */
function findEmbeddedDestinationKey(text: string): string | null {
  const cjkLabels = Object.keys(DESTINATION_ALIASES).filter((k) => /[\u4e00-\u9fff]/.test(k));
  cjkLabels.sort((a, b) => b.length - a.length);
  for (const label of cjkLabels) {
    if (text.includes(label)) return DESTINATION_ALIASES[label];
  }
  return null;
}

/**
 * 將目的地正規化為 cache key（例：釜山 / Busan / 부산 → busan）。
 * 用於跨裝置、跨次開啟共用同一張 Unsplash 目的地封面。
 */
export function normalizeDestinationKey(destination: string): string {
  const raw = destination.trim();
  if (!raw) return "unknown";

  const primary = extractPrimaryDestinationLabel(raw);

  const fromPrimary = resolveKnownDestinationKey(primary);
  if (fromPrimary) return fromPrimary;

  const fromEmbedded = findEmbeddedDestinationKey(raw) ?? findEmbeddedDestinationKey(primary);
  if (fromEmbedded) return fromEmbedded;

  const latin = slugifyLatin(primary);
  if (latin.length >= 2) {
    const fromLatin = resolveKnownDestinationKey(latin.replace(/-/g, " "));
    if (fromLatin) return fromLatin;
    return latin;
  }

  const hash = Array.from(primary)
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0)
    .toString(36);
  return `dest-${hash}`;
}
