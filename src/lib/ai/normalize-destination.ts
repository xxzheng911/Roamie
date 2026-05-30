/**
 * 目的地正規化：從使用者句子抽出「乾淨」城市名，移除語氣詞／問句尾巴。
 */

export const KNOWN_DESTINATION_NAMES =
  "台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|嘉義|花蓮|台東|臺東|宜蘭|澎湖|金門|馬祖|墾丁|京都|大阪|東京|橫濱|名古屋|福岡|北海道|札幌|沖繩|奈良|神戶|廣島|金澤|首爾|釜山|濟州|大邱|仁川|香港|澳門|新加坡|曼谷|清邁|巴黎|倫敦|紐約|洛杉磯|舊金山|雪梨|墨爾本";

/** 最長地名優先，避免「京都」被拆成「京」 */
const KNOWN_DESTINATIONS_LONGEST_FIRST = KNOWN_DESTINATION_NAMES.split("|").sort(
  (a, b) => b.length - a.length,
);

const KNOWN_DESTINATION_RE = new RegExp(
  `^(${KNOWN_DESTINATIONS_LONGEST_FIRST.join("|")})(市|縣|都|府|道)?$`,
  "iu",
);

const KNOWN_DESTINATION_IN_TEXT_RE = new RegExp(
  `(${KNOWN_DESTINATIONS_LONGEST_FIRST.join("|")})(?:市|縣|都|府|道)?`,
  "giu",
);

const SEASON_NOISE_RE =
  /(春天|夏天|秋天|冬天|早春|晚春|初夏|盛夏|秋末|初冬|春季|夏季|秋季|冬季)/gu;

/** 問句／語氣尾巴（由長到短匹配） */
const DESTINATION_TAIL_RE =
  /(有什麼好玩|有什麼|怎麼樣|適合嗎|好玩嗎|可以嗎|推薦嗎|適合拍照嗎|適合晚上去嗎|附近呢|附近|那邊|那裡|那里|呢|嗎|？|\?)+$/u;

const DESTINATION_PREFIX_RE = /^(那|這|去|到|在|跟|和|與)+/u;

const DESTINATION_FALSE_POSITIVES = new Set([
  "比較好",
  "比较好",
  "更好",
  "最好",
  "好玩",
  "方便",
  "適合",
  "合适",
  "附近",
  "這裡",
  "这里",
  "那裡",
  "那里",
  "看看",
  "逛逛",
  "走走",
  "晚上",
  "春天",
  "夏天",
  "秋天",
  "冬天",
]);

export function isKnownDestinationName(name: string): boolean {
  const t = name.trim().replace(DESTINATION_TAIL_RE, "").replace(/(市|縣|都|府|道)$/u, "");
  if (!t || DESTINATION_FALSE_POSITIVES.has(t)) return false;
  return KNOWN_DESTINATION_RE.test(t);
}

function stripDestinationNoise(text: string): string {
  return text.replace(SEASON_NOISE_RE, " ").replace(/\s+/g, " ").trim();
}

/** 從整句找出最長的已知城市名 */
export function extractKnownDestinationFromText(text: string): string | undefined {
  const t = stripDestinationNoise(text.trim());
  if (!t) return undefined;

  let best: string | undefined;
  let bestLen = 0;
  for (const m of t.matchAll(KNOWN_DESTINATION_IN_TEXT_RE)) {
    const name = m[1]?.trim().replace(/(市|縣|府|道)$/u, "");
    if (!name || name.length <= bestLen) continue;
    bestLen = name.length;
    best = name;
  }
  return best;
}

/** 清理可能含語氣詞的目的地字串 */
export function normalizeDestination(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;

  let t = stripDestinationNoise(raw.trim())
    .replace(DESTINATION_PREFIX_RE, "")
    .replace(DESTINATION_TAIL_RE, "")
    .trim();
  if (!t || DESTINATION_FALSE_POSITIVES.has(t)) return undefined;

  const embedded = extractKnownDestinationFromText(t);
  if (embedded) return embedded;

  if (isKnownDestinationName(t)) return t;

  // 僅剝離「市／府／道」等後綴；勿刪「京都」的「都」
  const stripped = t.replace(/(市|縣|府|道)$/u, "").trim();
  if (stripped && isKnownDestinationName(stripped)) return stripped;

  return undefined;
}

/** 是否為純代名詞／追問（不應當作新目的地） */
export function isPronounOrFollowUpOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^(那附近|那邊|那里|那裡|這附近|這一帶|這邊|附近還有|附近呢|周邊|周圍|旁邊)/.test(t)) return true;
  if (/^(適合晚上去嗎|適合拍照嗎|適合嗎|好玩嗎|可以嗎|怎麼樣)[？?]?$/.test(t)) return true;
  if (!extractKnownDestinationFromText(t) && t.length <= 12) return /嗎|呢|？|\?/.test(t);
  return false;
}

export function resolveCleanDestination(
  userText: string,
  hints?: {
    rawDestination?: string | null;
    sessionDestination?: string | null;
    preferredArea?: string | null;
  },
): string | undefined {
  if (isPronounOrFollowUpOnly(userText)) {
    return (
      normalizeDestination(hints?.sessionDestination) ??
      normalizeDestination(hints?.rawDestination) ??
      normalizeDestination(hints?.preferredArea)
    );
  }

  return (
    extractKnownDestinationFromText(userText) ??
    normalizeDestination(hints?.rawDestination) ??
    normalizeDestination(hints?.sessionDestination) ??
    normalizeDestination(hints?.preferredArea)
  );
}
