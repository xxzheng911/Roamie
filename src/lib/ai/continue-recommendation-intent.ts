/**
 * Unified Continue Recommendation grammar.
 *
 * All “more / another / nearby still have …” phrasings map to one intent.
 * Do not grow per-path fixed-string lists — use this detector everywhere.
 *
 * Grammar (slots, order flexible):
 *   [geo]? [more_marker]+ [request_verb]? [quantity]? [category]? [particle]?
 */
import { parseChatPlaceIntents } from "@/lib/ai/chat-place-intent";
import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";

const GEO_RE = /附近|這一帶|这一带|這邊|这边|附近的|順路|顺路/;

const MORE_MARKER_RE =
  /還有|还有|再|換|换|其他|別的|别的|更多|另外|又|多給|多给/;

const REQUEST_VERB_RE =
  /推薦|推荐|給我|给我|找|來|来|幫我|帮我|找找|看看|看/;

const QUANTITY_RE = /幾個|几个|一些|一點|一点|一批|幾間|几间|幾家|几家|別的|别的/;

const PARTICLE_RE = /[嗎么呢呀啊嘛喔哦喲哟哇咧吧]+$/;

const REJECT_BATCH_RE =
  /不要這些|不要这几个|不要這幾個|不想要這些|不想要这些|不喜歡這些|不喜欢这些|換掉這些|换掉这些|不要重複|不要重复|換一批|换一批/;

/** Explicit new-trip / destination change — not continue. */
const HARD_NON_CONTINUE_RE =
  /幫我規劃|帮我规划|規劃行程|规划行程|安排行程|幾天幾夜|几天几夜|\d+\s*天\s*\d*\s*夜|換個目的地|换个目的地|改去|改成去/;

const MAX_CONTINUE_LEN = 48;

function stripTrailingNoise(text: string): string {
  return text
    .trim()
    .replace(/[？?！!。.．…〜~]+$/g, "")
    .replace(PARTICLE_RE, "")
    .trim();
}

/**
 * True when user asks for more of the *same* recommendation stream
 * (not a refinement slot change, not a new trip plan).
 */
export function matchesContinueRecommendationGrammar(text: string): boolean {
  const raw = text.trim();
  if (!raw || raw.length > MAX_CONTINUE_LEN) return false;
  if (HARD_NON_CONTINUE_RE.test(raw)) return false;

  if (REJECT_BATCH_RE.test(raw)) return true;

  const t = stripTrailingNoise(raw);
  if (!t) return false;

  const hasMore = MORE_MARKER_RE.test(t);
  if (!hasMore) return false;

  // Short pure continue: 「還有嗎」「其他呢」「再來」
  if (t.length <= 10) return true;

  const hasGeo = GEO_RE.test(t);
  const hasVerb = REQUEST_VERB_RE.test(t);
  const hasQty = QUANTITY_RE.test(t);
  const hasCategory = parseChatPlaceIntents(t).length > 0;

  // 「還有推薦嗎」「再給我更多」「附近還有嗎」「還有其他咖啡廳嗎」
  if (hasVerb || hasQty || hasGeo || hasCategory) return true;

  // Soft compounds without verb: 「還有其他嗎」「有別的嗎」
  if (/(還有其他|还有其他|有其他|有別的|有别的|其他推薦|其他推荐)/.test(t)) {
    return true;
  }

  // 「更多」alone or with light modifiers
  if (/更多/.test(t) && t.length <= 16) return true;

  return false;
}

/**
 * Optional category mentioned in a continue phrase (same-topic → continue;
 * different topic → topic switch handled by caller).
 */
export function continueRecommendationMentionedCategory(
  text: string,
): ChatPlaceCategoryIntent | null {
  if (!matchesContinueRecommendationGrammar(text)) return null;
  return parseChatPlaceIntents(text)[0] ?? null;
}
