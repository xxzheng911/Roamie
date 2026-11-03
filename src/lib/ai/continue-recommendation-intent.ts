/**
 * Unified Continue Recommendation grammar.
 *
 * All “more / another / nearby still have …” phrasings map to one intent.
 * Do not grow per-path fixed-string lists — use this detector everywhere.
 *
 * Grammar (slots, order flexible):
 *   [geo]? [more_marker]+ [request_verb]? [quantity]? [category]? [particle]?
 */
import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";

const GEO_RE = /附近|這一帶|这一带|這邊|这边|附近的|順路|顺路/;

const MORE_MARKER_RE =
  /還有|还有|再|換|换|其他|別的|别的|更多|另外|又|多給|多给/;

const REQUEST_VERB_RE =
  /推薦|推荐|給我|给我|找|來|来|幫我|帮我|找找|看看|看/;

const QUANTITY_RE = /幾個|几个|一些|一點|一点|一批|幾間|几间|幾家|几家|別的|别的/;

const PARTICLE_RE = /[嗎么呢呀啊嘛喔哦喲哟哇咧吧]+$/;

/** Lexical-only by design: the full place parser calls this continue grammar. */
const CONTINUE_CATEGORY_RE =
  /咖啡|café|cafe|餐廳|美食|吃飯|拉麵|拉面|壽司|寿司|燒肉|烧肉|火鍋|商圈|購物|百貨|商場|mall|outlet|景點|美術館|博物館|museum|夜市|酒吧|居酒屋|宵夜|室內|雨天/i;

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
  const hasCategory = CONTINUE_CATEGORY_RE.test(t);

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

// ─────────────── Structured continuation boundary (additive; grammar above is frozen) ───────────────

/** Literal alternatives of the existing grammar regexes (no new vocabulary). */
function grammarLiterals(re: RegExp): string[] {
  return re.source.split("|").filter(Boolean);
}

const MORE_MARKER_LITERALS = grammarLiterals(MORE_MARKER_RE);
const REJECT_BATCH_LITERALS = grammarLiterals(REJECT_BATCH_RE);
/** Tokens a continuation tail may be composed of (existing grammar slots only). */
const TAIL_TOKEN_LITERALS = [
  ...MORE_MARKER_LITERALS,
  ...grammarLiterals(REQUEST_VERB_RE),
  ...grammarLiterals(QUANTITY_RE),
  ...grammarLiterals(GEO_RE),
];
const CATEGORY_LITERALS = grammarLiterals(CONTINUE_CATEGORY_RE).map((v) => v.toLowerCase());
/** 「咖啡廳」「咖啡店」: a category slot may carry one venue suffix char. */
const CATEGORY_SUFFIX_RE = /[廳厅店]/;
/** Joiners inside the soft compounds the grammar already accepts (「有其他的嗎」). */
const TAIL_JOINER_RE = /[的有]/;
/**
 * Counted quantity (「3個」「5間」「三家」): a number followed by a measure word that the
 * existing QUANTITY_RE already uses after 幾／几 (個 个 間 间 家). One quantity-slot token;
 * the number is never part of the candidate text.
 */
const QUANTITY_UNITS = grammarLiterals(QUANTITY_RE)
  .filter((lit) => /^[幾几]./.test(lit))
  .map((lit) => lit.slice(1));
const COUNTED_QUANTITY_RE = new RegExp(
  `^(?:\\d{1,3}|[０-９]{1,3}|[一二兩两三四五六七八九十]{1,3})\\s*(?:${QUANTITY_UNITS.join("|")})`,
);
const TAIL_PUNCT_RE = /[\s，,、？?！!。.．…〜~]/;
const LEAD_PUNCT_TRIM_RE = /^[\s，,、]+|[\s，,、]+$/g;
/** Sentence-initial courtesy word (kept only with a clear boundary; see analyze). */
const LEADING_COURTESY_RE = /^(?:好|請|请)/;
/**
 * Sentence-initial switch verb before a new destination (「換大阪」「換成金澤」「改金澤」):
 * the whole verb is dropped, never leaving a verb remainder (「成金澤」).
 */
const LEADING_SWITCH_RE = /^(?:換成去|换成去|改成去|換成|换成|改成|改去|換|换|改)/;
/** Negation of going to a place (「不去」「不要去」「不想去」「別去」). */
const NEGATED_GO_VERB = "(?:不去|不要去|不想去|別去|别去)";
/** One negated place slot: no separator, switch verb or particle 了 inside. */
const NEGATED_PLACE_SLOT = "([^\\s，,、換换改了]{1,24}?)";
/**
 * Sentence-initial negated old destination right before the switch verb
 * (「不去大阪了，換金澤」「大阪不去了，換金澤」「不要去大阪，改金澤」): the negated place is
 * dropped, only the switched-to place remains. Group 1 / 2: the negated place.
 */
const LEADING_NEGATED_SWITCH_RE = new RegExp(
  `^(?:${NEGATED_GO_VERB}${NEGATED_PLACE_SLOT}|${NEGATED_PLACE_SLOT}${NEGATED_GO_VERB})` +
    "了?[\\s，,、]*(?=[換换改][^\\s，,、])",
);

/** Sentence-initial pronoun / connective before a negated go verb (「我不想去」「那就不去」). */
const NEGATED_CLAUSE_PRONOUN = "(?:我們|我们|那我|那就|我|那|就|還是|还是|先)";
/** One negated place slot of the extended clause: no separator, switch verb, 去 or 了 inside. */
const NEGATED_CLAUSE_SLOT = "([^\\s，,、換换改去了]{1,24}?)";
const NEGATED_CLAUSE_SEP = "[\\s，,、]*";
/** Lead verb of the switched-to wording in the extended clause (「換」「換成去」「去」). */
const NEGATED_CLAUSE_LEAD =
  "(?:換成去|换成去|改成去|換去|换去|改去|換成|换成|改成|換到|换到|改到|換|换|改|去)";
const NEGATED_CLAUSE_LEAD_RE = new RegExp(`^${NEGATED_CLAUSE_LEAD}`);
/**
 * Extended negated clause (「我不想去大阪了，換金澤」「不去大阪了，去京都玩」「我不去了換金澤」):
 * same NEGATED_GO_VERB, optional pronoun, optional negated place; group 1 / 2: negated place.
 */
const LEADING_NEGATED_CLAUSE_EXTENDED_RE = new RegExp(
  `^(?:${NEGATED_CLAUSE_PRONOUN}?${NEGATED_GO_VERB}${NEGATED_CLAUSE_SLOT}?|` +
    `${NEGATED_CLAUSE_SLOT}${NEGATED_GO_VERB})了?${NEGATED_CLAUSE_SEP}` +
    `(?=${NEGATED_CLAUSE_LEAD}[^\\s，,、])`,
);
/**
 * Negated clause without a switch target (「不想去金澤玩推薦別的」「別去大阪玩了，推薦別的地方」):
 * same tokens as the extended clause without the lead look-ahead; group 1 / 2: negated place.
 */
const LEADING_NEGATED_CLAUSE_ONLY_RE = new RegExp(
  `^(?:${NEGATED_CLAUSE_PRONOUN}?${NEGATED_GO_VERB}${NEGATED_CLAUSE_SLOT}|` +
    `${NEGATED_CLAUSE_SLOT}${NEGATED_GO_VERB})` +
    `(?:了${NEGATED_CLAUSE_SEP}|[\\s，,、]+|(?=推薦|推荐)|$)`,
);
/** Idioms after a negated clause that are not a switch verb (「改天再說」「換一下」). */
const NEGATED_CLAUSE_IDIOM_RE =
  /^(?:改天|改日|改期|改時間|改时间|換一下|换一下|換個|换个|換一批|换一批|換別|换别)/;

export type LeadingNegatedClause = {
  form: "legacy" | "extended" | "negated_only";
  /** Length of the matched sentence-initial clause (pronoun, negated place, 了, separators). */
  length: number;
  /** The negated place wording, exactly as written; "" when none (extended only). */
  negatedText: string;
  /** The wording after the clause starts with an idiom (「改天再說」), not a switch verb. */
  idiom?: boolean;
};

/**
 * Sentence-initial negated clause, matched in order legacy → extended → negated_only.
 * Lexical only: decides no destination and no geographic level.
 */
export function matchLeadingNegatedClause(text: string): LeadingNegatedClause | null {
  const raw = text ?? "";
  const withIdiom = (
    form: "legacy" | "extended",
    match: RegExpMatchArray,
  ): LeadingNegatedClause => {
    const length = match[0].length;
    const negatedText = (match[1] ?? match[2] ?? "").trim();
    return NEGATED_CLAUSE_IDIOM_RE.test(raw.slice(length))
      ? { form, length, negatedText, idiom: true }
      : { form, length, negatedText };
  };
  const legacy = raw.match(LEADING_NEGATED_SWITCH_RE);
  if (legacy) return withIdiom("legacy", legacy);
  const extended = raw.match(LEADING_NEGATED_CLAUSE_EXTENDED_RE);
  if (extended) return withIdiom("extended", extended);
  const negatedOnly = raw.match(LEADING_NEGATED_CLAUSE_ONLY_RE);
  if (negatedOnly) {
    return {
      form: "negated_only",
      length: negatedOnly[0].length,
      negatedText: (negatedOnly[1] ?? negatedOnly[2] ?? "").trim(),
    };
  }
  return null;
}

/**
 * Grammar tokens starting at `i`: length + weight (counted grammar tokens; a reject-batch
 * phrase is a complete continuation by itself, separators / joiners count 0).
 */
function tailTokens(text: string, i: number): Array<{ length: number; weight: number }> {
  const found: Array<{ length: number; weight: number }> = [];
  for (const lit of REJECT_BATCH_LITERALS) {
    if (text.startsWith(lit, i)) found.push({ length: lit.length, weight: 2 });
  }
  for (const lit of TAIL_TOKEN_LITERALS) {
    if (text.startsWith(lit, i)) found.push({ length: lit.length, weight: 1 });
  }
  const lower = text.toLowerCase();
  for (const lit of CATEGORY_LITERALS) {
    if (!lower.startsWith(lit, i)) continue;
    found.push({ length: lit.length, weight: 1 });
    const next = text.charAt(i + lit.length);
    if (next && CATEGORY_SUFFIX_RE.test(next)) found.push({ length: lit.length + 1, weight: 1 });
  }
  const counted = text.slice(i).match(COUNTED_QUANTITY_RE);
  if (counted) found.push({ length: counted[0].length, weight: 1 });
  const ch = text.charAt(i);
  if (ch && PARTICLE_RE.test(ch)) found.push({ length: 1, weight: 1 });
  if (ch && TAIL_PUNCT_RE.test(ch)) found.push({ length: 1, weight: 0 });
  if (ch && TAIL_JOINER_RE.test(ch)) found.push({ length: 1, weight: 0 });
  return found;
}

/**
 * best[i]: max number of counted grammar tokens that consume text[i..end] completely
 * (-1 when text[i..end] is not fully made of continuation grammar).
 */
function tailConsumption(text: string): number[] {
  const best = new Array<number>(text.length + 1).fill(-1);
  best[text.length] = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    for (const token of tailTokens(text, i)) {
      const rest = best[i + token.length];
      if (rest < 0) continue;
      best[i] = Math.max(best[i], rest + token.weight);
    }
  }
  return best;
}

/** A cut may only start at a continuation marker (or a reject-batch phrase / 「有」+marker). */
function isCutPoint(text: string, i: number): boolean {
  const startsWithMarker = (at: number) =>
    MORE_MARKER_LITERALS.some((lit) => text.startsWith(lit, at));
  if (startsWithMarker(i)) return true;
  if (REJECT_BATCH_LITERALS.some((lit) => text.startsWith(lit, i))) return true;
  return text.charAt(i) === "有" && startsWithMarker(i + 1);
}

/** True when `text` consists only of geo-slot words / separators (「附近」「這邊」). */
function isOnlyGeoSlot(text: string): boolean {
  const geo = grammarLiterals(GEO_RE);
  const ok = new Array<boolean>(text.length + 1).fill(false);
  ok[text.length] = true;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (TAIL_PUNCT_RE.test(text.charAt(i)) && ok[i + 1]) ok[i] = true;
    for (const lit of geo) if (text.startsWith(lit, i) && ok[i + lit.length]) ok[i] = true;
  }
  return ok[0];
}

export type ContinueRecommendationStructure = {
  /** The whole sentence is a continue-recommendation request (boundary found). */
  isContinue: boolean;
  /** Index in the original (trimmed) text where the continuation tail starts; -1 when none. */
  boundaryIndex: number;
  /** The continuation tail exactly as written (「再推薦幾個」「還有嗎」); "" when none. */
  continuationText: string;
  /** Original wording before the boundary, untouched (whole text when not a continuation). */
  leadingText: string;
  /**
   * Text to hand to the Destination Authority: leadingText without boundary separators,
   * sentence-initial courtesy word and switch verb. Never contains continuation-tail wording.
   * Not a destination: the Authority decides whether it names one.
   */
  candidateText: string;
  /** candidateText is non-empty (a place may be named; existence is NOT decided here). */
  hasPendingPlaceCandidate: boolean;
  /** The caller must ask the Destination Authority (candidateText, or the whole text). */
  requiresDestinationAuthority: boolean;
};

/**
 * Structured continuation semantics of the full sentence. Pure and lexical: only splits the
 * sentence at a continuation boundary. A boundary exists only when, from a continuation marker
 * to the end, the text is made entirely of the existing grammar slots (marker / verb / quantity /
 * category / particle) with at least two grammar tokens; request verbs and category words are
 * never cut points. Does not decide whether a place exists or which city it is.
 */
export function analyzeContinueRecommendationStructure(
  text: string,
): ContinueRecommendationStructure {
  const raw = (text ?? "").trim();
  const notContinue: ContinueRecommendationStructure = {
    isContinue: false,
    boundaryIndex: -1,
    continuationText: "",
    leadingText: raw,
    candidateText: raw,
    hasPendingPlaceCandidate: Boolean(raw),
    requiresDestinationAuthority: Boolean(raw),
  };
  if (!raw || raw.length > MAX_CONTINUE_LEN || HARD_NON_CONTINUE_RE.test(raw)) return notContinue;

  const best = tailConsumption(raw);
  let cut = -1;
  for (let i = 0; i < raw.length; i += 1) {
    if (best[i] >= 2 && isCutPoint(raw, i)) {
      cut = i;
      break;
    }
  }
  if (cut < 0) return notContinue;
  // Never wider than the frozen grammar: the tail itself must be accepted by it.
  if (!matchesContinueRecommendationGrammar(raw.slice(cut))) return notContinue;

  const leadingText = raw.slice(0, cut).trim();
  let candidate = leadingText.replace(LEAD_PUNCT_TRIM_RE, "");
  if (candidate && isOnlyGeoSlot(candidate)) candidate = "";
  const courtesy = candidate.match(LEADING_COURTESY_RE);
  if (courtesy) {
    const rest = candidate.slice(courtesy[0].length);
    const separated = /^[\s，,、]/.test(rest);
    // Courtesy word only right before the tail, or followed by an explicit separator.
    if (!rest || separated) candidate = rest.replace(LEAD_PUNCT_TRIM_RE, "");
  }
  const negatedClause = matchLeadingNegatedClause(candidate);
  if (negatedClause) candidate = candidate.slice(negatedClause.length);
  if (negatedClause?.idiom || negatedClause?.form === "negated_only") {
    // Idiom (「改天再說」) / no switch target: only the negated clause is dropped.
  } else if (negatedClause?.form === "extended") {
    const lead = candidate.match(NEGATED_CLAUSE_LEAD_RE);
    if (lead) candidate = candidate.slice(lead[0].length).replace(LEAD_PUNCT_TRIM_RE, "");
  } else {
    const switchVerb = candidate.match(LEADING_SWITCH_RE);
    if (switchVerb && candidate.length > switchVerb[0].length) {
      candidate = candidate.slice(switchVerb[0].length).replace(LEAD_PUNCT_TRIM_RE, "");
    }
  }
  return {
    isContinue: true,
    boundaryIndex: cut,
    continuationText: raw.slice(cut),
    leadingText,
    candidateText: candidate,
    hasPendingPlaceCandidate: Boolean(candidate),
    requiresDestinationAuthority: Boolean(candidate),
  };
}

export type NegatedDestinationSwitch = {
  /** The negated (dropped) place wording, exactly as written (「大阪」). Never a destination. */
  negatedText: string;
  /**
   * The switched-to wording after the switch verb, without continuation tail / separators
   * (「金澤」); "" when none. Not a destination: the Authority decides whether it names one.
   */
  switchedText: string;
  /** The original wording after the negated clause, switch verb kept (「換金澤，再推薦幾個」). */
  remainderText: string;
  /** Which negated clause matched (negated_only never yields a switch). */
  form?: "legacy" | "extended";
  /** The wording after the clause is an idiom (「改天再說」), not a switch verb. */
  idiom?: boolean;
};

/**
 * Sentence-initial「不去X了，換Y」/「X不去了，換Y」/「不要去X，改Y」/「不想去X了，換成Y」. Same lexical
 * grammar as analyzeContinueRecommendationStructure (no destination decided); null otherwise.
 */
export function parseNegatedDestinationSwitch(text: string): NegatedDestinationSwitch | null {
  const raw = (text ?? "").trim();
  const negated = matchLeadingNegatedClause(raw);
  // negated_only has no switch target: parse stays「否定＋切換」only.
  if (negated?.form === "negated_only") return null;
  const negatedText = negated?.negatedText ?? "";
  if (!negated || !negatedText) return null;
  const { remainderText, switchedText } = negatedClauseSwitchedText(raw, negated);
  const idiom = negated.idiom ? { idiom: true } : {};
  return { negatedText, switchedText, remainderText, form: negated.form, ...idiom };
}

/**
 * Wording after a matched negated clause (`clause` from matchLeadingNegatedClause(text)):
 * remainderText keeps the switch verb; afterLeadText drops it (legacy: current switch verb;
 * extended: the whole lead incl.「去」; idiom / negated_only: nothing); switchedText is
 * afterLeadText without continuation tail / separators. Lexical only; decides no destination.
 * `fullLead` (classify only): a non-idiom legacy clause drops the same full lead as extended
 * (「換到京都」→「京都」); without it the legacy output is unchanged (parse contract).
 */
export function negatedClauseSwitchedText(
  text: string,
  clause: LeadingNegatedClause,
  options?: { fullLead?: boolean },
): { remainderText: string; afterLeadText: string; switchedText: string } {
  const raw = text ?? "";
  const remainderText = raw.slice(clause.length);
  let rest = remainderText;
  const legacyFullLead = clause.form === "legacy" && !clause.idiom && options?.fullLead === true;
  if (clause.form === "legacy" && !legacyFullLead) {
    const switchVerb = rest.match(LEADING_SWITCH_RE);
    if (switchVerb) rest = rest.slice(switchVerb[0].length);
  } else if (legacyFullLead || (clause.form === "extended" && !clause.idiom)) {
    const lead = rest.match(NEGATED_CLAUSE_LEAD_RE);
    if (lead) rest = rest.slice(lead[0].length);
  }
  const structure = analyzeContinueRecommendationStructure(rest);
  const switchedText = structure.isContinue
    ? structure.candidateText
    : stripTrailingNoise(rest).replace(LEAD_PUNCT_TRIM_RE, "");
  return { remainderText, afterLeadText: rest, switchedText };
}

/**
 * True when the text has wording before a trailing piece made only of continuation grammar that
 * is too weak to be a boundary (「…再」「…還」). Such text is no clean place label: callers must
 * not send it to provider validation. Pure and lexical; decides no destination.
 */
export function hasDanglingContinuationFragment(text: string): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.length > MAX_CONTINUE_LEN) return false;
  const best = tailConsumption(raw);
  for (let i = 1; i < raw.length; i += 1) {
    if (best[i] < 1 || !isCutPoint(raw, i)) continue;
    const leading = raw.slice(0, i).replace(LEAD_PUNCT_TRIM_RE, "");
    if (leading && !isOnlyGeoSlot(leading)) return true;
  }
  return false;
}

/**
 * True when the whole text is made only of continuation grammar tokens with at least one
 * counted token (「一家」「別的」「其他的」): an alternative-recommendation phrase, never a place
 * label. Same tokens as the boundary analysis; pure and lexical; decides no destination.
 */
export function isContinuationGrammarOnly(text: string): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.length > MAX_CONTINUE_LEN) return false;
  return tailConsumption(raw)[0] >= 1;
}

/**
 * Optional category mentioned in a continue phrase (same-topic → continue;
 * different topic → topic switch handled by caller).
 */
export function continueRecommendationMentionedCategory(
  text: string,
): ChatPlaceCategoryIntent | null {
  if (!matchesContinueRecommendationGrammar(text)) return null;
  const t = text.trim();
  if (/咖啡|café|cafe/i.test(t)) return "cafe";
  if (/餐廳|美食|吃飯|拉麵|拉面|壽司|寿司|燒肉|烧肉|火鍋/.test(t)) return "restaurant";
  if (/商圈|購物|百貨|商場|mall|outlet/i.test(t)) return "shopping";
  if (/夜市/.test(t)) return "night_market";
  if (/酒吧|居酒屋|宵夜/.test(t)) return "bar";
  if (/室內|雨天/.test(t)) return "indoor";
  if (/景點|美術館|博物館|museum/i.test(t)) return "attraction";
  return null;
}
