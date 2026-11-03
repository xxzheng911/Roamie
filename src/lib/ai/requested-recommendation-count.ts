/**
 * 使用者指定的推薦數量（「推薦 10 個景點」「推薦五家餐廳」）。
 * 純文字解析，不呼叫任何 provider；顯示張數上限由
 * resolveRequestedDisplayBatchSize（conversation-recommendation-session）決定。
 */

/** 單輪顯示張數上限；超出部分交由續推（「還有嗎」）。 */
export const MAX_REQUESTED_DISPLAY_BATCH_SIZE = 10;

/**
 * 解析上限（COUNT_NUM 已限 1–3 位數；四位數年份如 2026 不會命中）。
 * 回傳原始值，「推薦 100 個」→ 100，顯示張數由 resolveRequestedDisplayBatchSize 截到 10。
 */
const MAX_PARSED_COUNT = 999;

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  兩: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 一～九、十、十一～十九、十幾、二十～九十九；百、一百～九百（可接「零五」「二十」等尾數）。 */
function parseChineseCount(raw: string): number | null {
  if (CN_DIGIT[raw] != null) return CN_DIGIT[raw];
  const h = raw.match(/^([一二兩两三四五六七八九])?百(?:零([一二三四五六七八九])|(.+))?$/);
  if (h) {
    const hundreds = (h[1] ? CN_DIGIT[h[1]]! : 1) * 100;
    if (h[2]) return hundreds + CN_DIGIT[h[2]]!;
    if (!h[3]) return hundreds;
    // 「一百二」= 120；「一百二十五」= 125。
    const rest = CN_DIGIT[h[3]] != null ? CN_DIGIT[h[3]]! * 10 : parseChineseCount(h[3]);
    return rest != null && rest < 100 && !/^十/.test(h[3]) ? hundreds + rest : null;
  }
  const m = raw.match(/^([二兩两三四五六七八九])?十([一二三四五六七八九]|幾|几)?$/);
  if (!m) return null;
  const tens = m[1] ? CN_DIGIT[m[1]] : 1;
  const ones = m[2] && m[2] !== "幾" && m[2] !== "几" ? CN_DIGIT[m[2]] : 0;
  return tens * 10 + ones;
}

const COUNT_NUM = String.raw`(\d{1,3}|[０-９]{1,3}|[一二兩两三四五六七八九十幾几百零]{1,5})`;
/**
 * 量詞後不得接人數、時間、行政區、房間、臥室（「4個人」「2個多小時」「2個週末」「2 間房」
 * 「2 間臥室」）；量詞後有空白時同樣排除（「4 個 人」「3 個 小時」）。「人氣」不算人數。
 */
const COUNT_UNIT = String.raw`\s*(?:個|个|間|间|家|處|处)(?!\s*(?:多|人(?!氣|气)|臥室|卧室|大人|小孩|孩子|朋友|小時|小时|鐘頭|钟头|月|週|周|禮拜|礼拜|星期|晚上|夜晚|半|城市|國家|国家|地區|地区|區域|区域|房|客房|套房|床|(?:雙人|双人|單人|单人|兩人|两人|三人|四人|家庭|和室|和式)房))`;
/** 範圍分隔：「3-5」「3 - 5」「3~5」「3到5」「三到五」。 */
const RANGE_SEP = String.raw`\s*(?:-|－|–|—|~|～|〜|到|至)\s*`;
const VERB_RE_SRC = String.raw`(?:推薦|推荐|介紹|介绍|列出|給我|给我|找|挑)`;
/** 序數／指示詞／已去過等前綴與數字之間可夾空白（「這 3 個」「第 3 個」「去過 3 個」）。 */
const COUNT_LOOKBEHIND = String.raw`(?<!(?:[第\d０-９.這这那哪每同另一二兩两三四五六七八九十幾几百零\-~～－到至]|去過|去过|其中|訂|订|住過|住过)\s*)`;
const TAIL_TO_VERB = String.raw`[^\s，,。．！!？?；;、了]{0,6}?(?:推薦|推荐|介紹|介绍)`;
/** 範圍取上限：「推薦 3-5 個」「3 到 5 個景點推薦」→ 5。 */
const VERB_THEN_RANGE_RE = new RegExp(
  String.raw`${VERB_RE_SRC}\s*(?:我\s*)?${COUNT_NUM}${RANGE_SEP}${COUNT_NUM}${COUNT_UNIT}`,
  "g",
);
const RANGE_THEN_VERB_RE = new RegExp(
  String.raw`${COUNT_LOOKBEHIND}${COUNT_NUM}${RANGE_SEP}${COUNT_NUM}${COUNT_UNIT}${TAIL_TO_VERB}`,
  "g",
);
/** 推薦動詞緊接數量：「推薦 10 個」「幫我推薦五家」「給我 3 間」。 */
const VERB_THEN_COUNT_RE = new RegExp(
  String.raw`${VERB_RE_SRC}\s*(?:我\s*)?${COUNT_NUM}${COUNT_UNIT}`,
  "g",
);
/**
 * 數量後短距離（無標點、無「了」）接推薦動詞：「5個景點推薦」。
 * 不接在序數／指示詞／範圍符號／「去過」「其中」「訂」之後。
 */
const COUNT_THEN_VERB_RE = new RegExp(
  String.raw`${COUNT_LOOKBEHIND}${COUNT_NUM}${COUNT_UNIT}${TAIL_TO_VERB}`,
  "g",
);

/**
 * 推薦動詞與數量之間夾短目的地：「推薦京都 10 個景點」。
 * 夾段最多 10 字（「推薦北海道札幌市區 5 處景點」），不含數字、標點、「了／的／過」與序數／指示詞
 * （「上次推薦的 3 個都去過了」不算）；數量前仍套 COUNT_LOOKBEHIND。
 */
const VERB_SPAN_SRC = String.raw`${VERB_RE_SRC}\s*[^\s\d０-９，,。．！!？?；;、了的過过第這这那哪每]{1,10}?\s*${COUNT_LOOKBEHIND}`;
const VERB_SPAN_COUNT_RE = new RegExp(String.raw`${VERB_SPAN_SRC}${COUNT_NUM}${COUNT_UNIT}`, "g");
/** 夾段後接範圍：「推薦札幌 3~5 間拉麵店」→ 5（與 VERB_SPAN_COUNT_RE 同一夾段規則）。 */
const VERB_SPAN_RANGE_RE = new RegExp(
  String.raw`${VERB_SPAN_SRC}${COUNT_NUM}${RANGE_SEP}${COUNT_NUM}${COUNT_UNIT}`,
  "g",
);

function toCount(raw: string): number | null {
  const n = /^[\d０-９]+$/.test(raw)
    ? Number.parseInt(
        raw.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10)),
        10,
      )
    : parseChineseCount(raw);
  if (n == null || !Number.isFinite(n) || n <= 0 || n > MAX_PARSED_COUNT) return null;
  return n;
}

/**
 * 解析使用者要求的推薦數量；未指定或無法判定回傳 null。
 * 數量必須和推薦動詞相鄰（「推薦 N 個」或「N 個…推薦」）；天數、夜數、人數、時間、
 * 價格、星等、房間數、已去過／已選的件數不會命中。範圍（「推薦 3-5 個」「三到五個」）
 * 取上限。回傳原始值（不截斷；「推薦 100 個」→ 100），顯示張數上限 10 由
 * resolveRequestedDisplayBatchSize 負責。
 */
export function parseRequestedRecommendationCount(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  for (const re of [VERB_THEN_RANGE_RE, RANGE_THEN_VERB_RE, VERB_SPAN_RANGE_RE]) {
    for (const m of t.matchAll(re)) {
      const hi = toCount(m[2]!);
      if (hi == null) continue;
      const lo = toCount(m[1]!);
      return lo != null && lo > hi ? lo : hi;
    }
  }
  for (const re of [VERB_THEN_COUNT_RE, COUNT_THEN_VERB_RE, VERB_SPAN_COUNT_RE]) {
    for (const m of t.matchAll(re)) {
      const n = toCount(m[1]!);
      if (n != null) return n;
    }
  }
  return null;
}
