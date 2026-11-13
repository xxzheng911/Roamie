/**
 * 「都不錯但第二天改一下」/ "all good but change day 2" during combination_choice:
 * an agreement + contrast + modify-verb reply is a change request, not a combination pick.
 * It must not select a combination, start generation, or change the trip length
 * (「第 N 天」/ day N / N日目 / N일차 is a day ordinal, never a combination id or trip days).
 */
import type { Locale } from "@/lib/i18n/types";
import { chatRuntimeCopy } from "@/lib/chat-runtime-copy";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import { parseTravelDateRangeFromText, stripTravelDateRangeFromText } from "@/lib/ai/parse-travel-date-range";
import { isDateCorrectionRemainder } from "@/lib/ai/travel-language-signals";
import { applyCityLocaleAlias, canonicalFromDisplayName } from "@/lib/ai/destination-locale-aliases";
import { isKnownDestinationLabel, normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

const CN_ORDINAL: Record<string, number> = {
  一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

const EN_ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
const EN_NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const KO_ORDINAL_WORDS: Record<string, number> = {
  첫: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
};

const CN_NUM = "[一二兩两三四五六七八九十]|\\d{1,2}";
const numOf = (raw: string | undefined): number | undefined =>
  raw == null ? undefined : (CN_ORDINAL[raw] ?? (Number.isFinite(Number(raw)) ? Number(raw) : undefined));

/**
 * Day references (zh / en / ja / ko). `day` returns the 1-based day, or undefined for a day
 * without a number (「最後一天」"the last day"「最終日」「마지막 날」). Ranges / lists name their first day.
 * Order matters only for overlapping forms at the same position (ranges first).
 */
const DAY_FORMS: ReadonlyArray<{ re: RegExp; day: (m: RegExpMatchArray) => number | undefined }> = [
  // zh: 第二、三天 / 第2-3天 (「第二到第三天」is read by the next form as 第三天)
  { re: new RegExp(`第\\s*(${CN_NUM})\\s*(?:[、,，和跟及與与]|[-–~～])\\s*(?:${CN_NUM})\\s*(?:天|日)`), day: (m) => numOf(m[1]) },
  { re: new RegExp(`第\\s*(${CN_NUM})\\s*(?:天|日)(?!目)`), day: (m) => numOf(m[1]) },
  { re: /最後一天|最后一天|最終日|마지막\s*날|\b(?:the\s+)?last\s+day\b/i, day: () => undefined },
  { re: /頭一天|头一天|初日/, day: () => 1 },
  // en: days 2 and 3 / days 2-3 / day 2 / day two / 2nd day / the second day
  { re: /\bdays\s+(\d{1,2})\s*(?:and|&|-|–|to|,)\s*\d{1,2}\b/i, day: (m) => numOf(m[1]) },
  { re: /\bday\s*(\d{1,2})\b/i, day: (m) => numOf(m[1]) },
  { re: /\bday\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/i, day: (m) => EN_NUMBER_WORDS[m[1]!.toLowerCase()] },
  { re: /\b(\d{1,2})(?:st|nd|rd|th)\s+day\b/i, day: (m) => numOf(m[1]) },
  { re: /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+day\b/i, day: (m) => EN_ORDINAL_WORDS[m[1]!.toLowerCase()] },
  // ja: 2日目 / 二日目
  { re: new RegExp(`(${CN_NUM})\\s*日目`), day: (m) => numOf(m[1]) },
  // ko: 2일차 / 2일째 / 2번째 날 / 두 번째 날 / 둘째 날 / 첫째 날 / 이틀째
  { re: /(\d{1,2})\s*일\s*(?:차|째)/, day: (m) => numOf(m[1]) },
  { re: /(\d{1,2})\s*번째\s*날/, day: (m) => numOf(m[1]) },
  { re: /(첫|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*번째\s*날/, day: (m) => KO_ORDINAL_WORDS[m[1]!] },
  { re: /(첫|둘|셋|넷|다섯)째\s*날|첫\s*날/, day: (m) => (m[1] ? KO_ORDINAL_WORDS[m[1]] : 1) },
  { re: /이틀째|사흘째|나흘째/, day: (m) => ({ 이틀째: 2, 사흘째: 3, 나흘째: 4 })[m[0] as "이틀째"] },
];

/** Any day reference (detection / stripping). */
const DAY_ORDINAL_RE = new RegExp(DAY_FORMS.map((f) => `(?:${f.re.source})`).join("|"), "i");

/**
 * No-day partial agreement only (「都不錯但改一下」): agreement + contrast + a modify verb.
 * Day-reference replies never depend on the verb (see isDayReferenceHoldReply).
 */
const PARTIAL_MODIFY_RES: RegExp[] = [
  // zh: 都不錯／可以／不錯 + 但／不過／可是 + 改／換／調整／動一下／重新安排
  /(?:都不錯|不錯|都可以|可以|都很好|很好|都好|好的|沒問題|没问题|(?<![旅進进執执出步銀银流])行(?![程李動动為为走]))[\s\S]*?(?:但|不過|可是)[\s\S]*?(?:改|換|换|調整|调整|動一下|动一下|重新安排)/,
  // en: good／fine／great + but + change／swap／adjust／replace／edit／modify
  /\b(?:good|fine|great)\b[\s\S]*?\bbut\b[\s\S]*?\b(?:change|swap|adjust|replace|edit|modify)/i,
  // ja: いい／良い + でも／けど + 変え／変更／かえ／替え
  /(?:いい|良い|よい)[\s\S]*?(?:でも|けど)[\s\S]*?(?:変え|変更|かえ|替え)/,
  // ko: 좋 + 근데／하지만／그런데（좋은데 included） + 바꿔／바꿀／바꿨／변경
  /좋[\s\S]*?(?:근데|하지만|그런데|은데|는데|지만)[\s\S]*?(?:바꿔|바꾸|바꿀|바꿨|변경)/,
];

/** Clause boundaries for day-reference replies: only the last clause naming a day decides. */
const CLAUSE_SPLIT_RE = /但是|但|不過|不过|可是|\bbut\b|でも|けれど|けど|그런데|근데|하지만|[,，;；.。!！?？]/i;

/** Negation inside the deciding day clause (「第二天不用改」"don't change day 2"「変えなくていい」). */
const DAY_CLAUSE_NEGATION_RE =
  // 「別的／別處／別家／別間」(other …) are not negation; "not day 4" / "not on day 4" is.
  /不用|不要|不改|不換|不换|先不|沒有要|没有要|(?<!特|区|區|分|個|个|性)(?:別|别)(?![的處处家間间人種种のに])|\bdon['’]?t\b|\bdoesn['’]?t\b|\bwon['’]?t\b|\bnever\b|\bdo\s+not\b|\bnot\s+(?:on\s+)?(?:the\s+)?(?:day|\d{1,2}(?:st|nd|rd|th)|first|second|third|last)\b|\bno\s+change|\bno\s+need\b|\bleave\b|ない|なくて|しない|(?:^|\s)안\s|안(?=바꾸|바꿔|바꿀|변경)|지\s*마|지\s*말|필요\s*없/i;

/** An explicit combination reference keeps the original selection flow (「2번째 날」is a day). */
const COMBINATION_REFERENCE_RE =
  /第\s*(?:[一二兩两三四五六七八九十]|\d{1,2})\s*(?:組|组|個|个)|組合|组合|\bcombo|\bcombination|\boption|組み合わせ|\d+\s*番|조합|\d+\s*번(?!\s*째)/i;

/** Destination switches (「可以但改去大阪」) keep their existing route. */
const EXPLICIT_DESTINATION_SWITCH_RE =
  /改去|改成去|換成去|目的地(?:改成|換成)|\bswitch\s+to\b|\binstead\b|change\s+(?:the\s+)?destination/i;

/** Trip-length wording left after day ordinals are removed (「改成1天」「3 nights」「2박」「사흘」). */
const DURATION_HINT_RE =
  /(?:\d+|[一二兩两三四五六七八九十])\s*(?:天|晚|夜|日間|泊|일|박)|\b\d+\s*(?:days?|nights?)\b|하루|이틀|사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘/i;


/** An unnamed day (「其中一天換一下」"one of the days"): a day reference, never a trip length. */
// 「只有一天」is a trip length; 「ある日程」is a schedule; "some day trips" / "some day I'd…" are not a
// day of this trip; 「어느 날짜로」is a date change.
const VAGUE_DAY_RE =
  /其中一天|某一天|哪一天|(?<![只就還还沒没才])有一天|\bone\s+of\s+the\s+days\b|\bsome\s+day\b(?=[ \t]*(?:$|[,.?!]|(?:to|for|into|with)\b))|どこか(?:1|一)日|ある日(?![程付数本])|하루는|어느\s*날(?:은|에|을|이|도)?(?![가-힣])/i;

/** Negated modify (「但不用改」"don't change" 「変えないで」「바꾸지 마」): nothing to change. */
const NEGATED_MODIFY_RE =
  /不用|不要|(?<!特|区|區|分|個|个|性)(?:別|别)|\bdon['’]?t\b|\bdo\s+not\b|\bno\s+need\b|ないで|なくて|지\s*마|지\s*말/i;

/** Budget edits (「預算改成3萬」) keep the budget route. */
const BUDGET_RE =
  /預算|预算|\bbudget\b|予算|예산|(?:\d|[一二兩两三四五六七八九十百千])\s*(?:元|塊|萬|万|円|원)/i;

/** Place name written right after (zh / en) or before (ja / ko) the modify verb. */
const VERB_PLACE_RES: RegExp[] = [
  /(?:換成|换成|改成|改為|改为|換到|换到|改到)\s*([一-鿿A-Za-z]{2,12})/,
  /\b(?:change|swap|switch)\b[^.?!]*?\bto\s+([A-Za-z][A-Za-z .'-]{1,40})/i,
  /([぀-ヿ一-鿿A-Za-z]{2,16})(?:に|へ)\s*(?:変え|変更)/,
  /([가-힣一-鿿A-Za-z]{2,12})(?:으로|로)\s*(?:바꿔|바꾸|변경)/,
];

function isPlaceLabel(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 2) return false;
  const canonical = applyCityLocaleAlias(s);
  if (isKnownDestinationLabel(normalizeDestinationLabel(canonical))) return true;
  // ja / ko display names (「가마쿠라」「カマクラ」) of a known destination.
  const display = canonicalFromDisplayName(s);
  return Boolean(display && isKnownDestinationLabel(normalizeDestinationLabel(display)));
}

/** True when a known destination is named next to the modify verb (「換成大阪」"to Osaka"「大阪に変えて」「오사카로 바꿔」). */
function namesDestinationAtModifyVerb(text: string): boolean {
  for (const re of VERB_PLACE_RES) {
    const captured = text.match(re)?.[1]?.trim();
    if (!captured) continue;
    if (/^[A-Za-z]/.test(captured)) {
      const words = captured.split(/\s+/);
      for (let n = Math.min(3, words.length); n >= 1; n -= 1) {
        if (isPlaceLabel(words.slice(0, n).join(" "))) return true;
      }
      continue;
    }
    const chars = [...captured];
    for (let start = 0; start < chars.length; start += 1) {
      for (let end = chars.length; end - start >= 2; end -= 1) {
        if (isPlaceLabel(chars.slice(start, end).join(""))) return true;
      }
    }
  }
  return false;
}

function normalize(text: string): string {
  return text
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
}

/** 1-based day ordinal named in the reply (「第二天」→ 2), if any. */
export function parseDayOrdinalFromText(text: string): number | undefined {
  const t = normalize(text);
  let best: { index: number; day: number | undefined } | undefined;
  for (const form of DAY_FORMS) {
    const m = t.match(form.re);
    if (m?.index == null) continue;
    if (!best || m.index < best.index) best = { index: m.index, day: form.day(m) };
  }
  return best?.day;
}

function withoutDayOrdinals(t: string): string {
  return t
    .replace(new RegExp(DAY_ORDINAL_RE.source, "gi"), " ")
    .replace(new RegExp(VAGUE_DAY_RE.source, "gi"), " ");
}

/**
 * 「2日目を5日間に変えて」: the trip-length parsers read the first number, so day references are
 * removed first (→ 5). Text without a day reference is returned unchanged.
 */
export function withoutDayReferences(text: string): string {
  const t = normalize(text);
  return DAY_ORDINAL_RE.test(t) || VAGUE_DAY_RE.test(t) ? withoutDayOrdinals(t).replace(/\s+/g, " ").trim() : text;
}

/** Trip-length wording (「改成1天」「5 days」「사흘」), day ordinals excluded. */
export function hasTripLengthWording(text: string): boolean {
  const rest = withoutDayOrdinals(normalize(text));
  return Boolean(parseDayCountFromText(rest)) || DURATION_HINT_RE.test(rest);
}

/**
 * Modify verbs, used only where no concrete day ordinal is written: an unnamed day
 * (「其中一天換一下」) needs one, so 「哪一天出發都可以」「有一天會再去」stay on the HEAD route.
 */
const MODIFY_VERB_RE =
  /改|換|换|調整|调整|動一下|动一下|重新安排|\b(?:change|swap|adjust|switch|replace|edit|modify)|変え|変更|かえ|替え|바꿔|바꾸|바꿀|바꿨|변경/i;

function hasDayReference(t: string): boolean {
  return DAY_ORDINAL_RE.test(t) || (VAGUE_DAY_RE.test(t) && MODIFY_VERB_RE.test(t));
}

/**
 * Rule 1: a named (「第二天」"day 2"「2日目」「2일차」) or unnamed (「其中一天」) day, no explicit
 * combination reference and no separate trip length (「改成5天」, rule 1c) → this turn holds:
 * nothing selected, trip length unchanged, no generation — whatever the verb.
 */
function isDayReferenceHoldReply(t: string): boolean {
  return Boolean(t) && hasDayReference(t) && !COMBINATION_REFERENCE_RE.test(t) && !hasTripLengthWording(t);
}

/** Rule 2: the last contrast clause that names a day decides the reply. */
function decidingDayClause(t: string): string {
  // Contrast words and , ; . (not 、, which joins 「第二、三天」) split clauses. A clause without a
  // day belongs to the day clause before it (「day 2 is fine, no need to change」), so the deciding
  // part is the last day clause plus whatever follows it.
  // ja (kana present): 「、」also splits (「2日目は変えないで、3日目を変えて」); zh 「第二、三天」never.
  const splitRe = /[぀-ヿ]/.test(t) ? new RegExp(`${CLAUSE_SPLIT_RE.source}|、`, "i") : CLAUSE_SPLIT_RE;
  const clauses = t.split(splitRe).filter((c) => c.trim());
  for (let i = clauses.length - 1; i >= 0; i -= 1) {
    if (DAY_ORDINAL_RE.test(clauses[i]!) || VAGUE_DAY_RE.test(clauses[i]!)) return clauses.slice(i).join(" ");
  }
  return t;
}

/** No-day partial agreement (「都不錯但改一下」); exclusions keep the HEAD routes. */
function isNoDayPartialModifyReply(t: string): boolean {
  if (!t || t.length > 80) return false;
  if (!PARTIAL_MODIFY_RES.some((re) => re.test(t))) return false;
  if (COMBINATION_REFERENCE_RE.test(t)) return false;
  // 「改成去首爾吧」"switch it to Busan": a destination switch.
  if (EXPLICIT_DESTINATION_SWITCH_RE.test(t)) return false;
  if (NEGATED_MODIFY_RE.test(t) || BUDGET_RE.test(t)) return false;
  // 「可以但換成大阪」: a destination switch.
  if (namesDestinationAtModifyVerb(t)) return false;
  // A real trip-length change (「可以但改成5天」) is not this pattern.
  if (hasTripLengthWording(t)) return false;
  return true;
}

/** Hold + follow-up question: day reply whose deciding clause is not negated, or no-day partial. */
export function isCombinationPartialModifyReply(text: string): boolean {
  const t = normalize(text);
  if (isDayReferenceHoldReply(t)) return !DAY_CLAUSE_NEGATION_RE.test(decidingDayClause(t));
  return isNoDayPartialModifyReply(t);
}

/**
 * 「第二天不用改」"day 2 is fine, no need to change": hold, deciding day clause negated.
 * Nothing changes — no pick, no trip-length change; the reply is the selection nudge.
 */
export function isDayOrdinalNegatedModifyReply(text: string): boolean {
  const t = normalize(text);
  return isDayReferenceHoldReply(t) && DAY_CLAUSE_NEGATION_RE.test(decidingDayClause(t));
}

/**
 * 「第2組的第一天改一下」"option 2, but change day 1": an explicit combination plus a day.
 * The combination is selected from the text without its day references (never also [1]),
 * nothing is generated yet, and the reply asks to confirm generation with that combination.
 */
export function isCombinationRefWithDayReply(text: string): boolean {
  const t = normalize(text);
  return Boolean(t) && hasDayReference(t) && COMBINATION_REFERENCE_RE.test(t) && !hasTripLengthWording(t);
}

/** Any reply above: trip context is not merged and the pending pick is not taken from this text. */
export function isCombinationHoldReply(text: string): boolean {
  return (
    isCombinationPartialModifyReply(text) ||
    isDayOrdinalNegatedModifyReply(text) ||
    isCombinationRefWithDayReply(text)
  );
}

/** Reply to the confirm question: 「幫我生成」/ Create it for me chip / "create it for me" / …. */
export function isCombinationCreateConfirmReply(text: string): boolean {
  return /幫我生成|帮我生成|生成行程|^生成$|\bcreate\s+(?:it|the\s+itinerary)\b|この内容で作成|作成して|이대로\s*만들어|만들어\s*주세요/i.test(
    normalize(text),
  );
}

/**
 * Short yes right after the confirm question (「好」"ok"「はい」「네」). Only consulted while a
 * confirm is pending and valid — never a general rule.
 */
export function isCombinationConfirmAffirmation(text: string): boolean {
  const t = normalize(text).replace(/[!！。.~～、,，\s]+$/u, "").trim();
  return /^(?:好|好啊|好的|可以|行|沒問題|没问题|ok|okay|yes|yes please|sure|sounds good|はい|お願いします|それで|いいです|네|좋아요|그래요|응)$/i.test(t);
}

/** Session state the confirm was asked in; a nearby turn in between changes it. */
export function combinationConfirmContextKey(session: {
  explicitNearbyKeyword?: string | null;
  canonicalNearbyKeyword?: string | null;
}): string {
  return JSON.stringify([session.explicitNearbyKeyword ?? null, session.canonicalNearbyKeyword ?? null]);
}

type ConfirmPending = {
  type?: string;
  confirmCombinationTitles?: string[];
  confirmQuestion?: string;
  confirmContextKey?: string;
};

/**
 * The 「第2組的第一天改一下」confirm covers only the very next reply, right after that exact
 * question, in the same (non-nearby) context, and only a confirm phrase or a short yes uses it.
 * Anything else drops it, so 「全部」selects all again.
 */
export function dropStaleCombinationConfirm<
  S extends { pendingQuestion?: ConfirmPending | null; explicitNearbyKeyword?: string | null; canonicalNearbyKeyword?: string | null },
>(session: S, text: string, lastAssistantReply?: string | null): S {
  const pending = session.pendingQuestion;
  if (!pending?.confirmCombinationTitles) return session;
  const answersConfirm = isCombinationCreateConfirmReply(text) || isCombinationConfirmAffirmation(text);
  // Unknown last reply or question: not provably right after the confirm question → drop.
  const questionMatches =
    lastAssistantReply != null && pending.confirmQuestion != null && lastAssistantReply.trim() === pending.confirmQuestion.trim();
  const contextMatches =
    pending.confirmContextKey == null || pending.confirmContextKey === combinationConfirmContextKey(session);
  if (answersConfirm && questionMatches && contextMatches) return session;
  const { confirmCombinationTitles: _titles, confirmQuestion: _question, confirmContextKey: _key, ...rest } = pending;
  return { ...session, pendingQuestion: rest as S["pendingQuestion"] };
}

/** Confirm question after 「第2組的第一天改一下」; `combo` is the selected number(s), `missing` the non-offered ones. */
export function combinationRefDayConfirmCopy(text: string, combo: string, locale: Locale, missing?: string): string {
  const day = parseDayOrdinalFromText(text);
  const confirm = day
    ? chatRuntimeCopy("combinationRefDayConfirm", locale, { combo, day })
    : chatRuntimeCopy("combinationRefDayConfirmGeneric", locale, { combo });
  if (!missing) return confirm;
  const prefix = chatRuntimeCopy("combinationMissingPrefix", locale, { missing });
  // 「沒有第 3 組，已選第 1 組。…」/ "There's no combination 3, so combination 1 is selected. …"
  const body =
    locale === "zh-TW"
      ? confirm.replace(/^好，/, "")
      : locale === "en"
        ? confirm.replace(/^Got it, c/, "c")
        : confirm;
  return `${prefix}${body}`;
}

/**
 * 「可以但改成1天」while choosing combinations: the number is a trip length, never a
 * combination id. Explicit combination references (「第2組」「option 2」) still select.
 */
export function isTripLengthOnlyCombinationReply(text: string): boolean {
  const t = normalize(text);
  if (!t || COMBINATION_REFERENCE_RE.test(t)) return false;
  return hasTripLengthWording(t);
}

/** Combination list is on screen and waiting for a pick. */
export function isCombinationChoiceTurn(session: {
  pendingQuestion?: { type?: string } | null;
}): boolean {
  return session.pendingQuestion?.type === "combination_choice";
}

/** 「Sorry it's 12/10-12/13」「改成12/10到12/13」: only a date range plus correction filler. */
/** 「Sydney 12/10-12/13」 on the Sydney trip (current destination named) counts too. */
export function isCombinationDateCorrectionReply(text: string, currentDestinations: Array<string | null | undefined> = []): boolean {
  const range = parseTravelDateRangeFromText(text);
  if (!range.startDate || !range.endDate) return false;
  const rest = stripTravelDateRangeFromText(text);
  if (!rest || isDateCorrectionRemainder(rest)) return true;
  const bare = rest.replace(/(?<=[\p{Script=Han}\p{Script=Katakana}])(?:に|へ|で)$|(?<=\p{Script=Hangul})(?:으로|에)$/u, "").trim();
  const label = normalizeDestinationLabel(bare);
  return currentDestinations.some((d) => d?.trim() && normalizeDestinationLabel(d) === label);
}

/** Acknowledges the new dates; the caller keeps the combination_choice pending. */
export function combinationDatesUpdatedCopy(text: string, locale: Locale): string {
  const range = parseTravelDateRangeFromText(text);
  const md = (iso?: string) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "");
  return chatRuntimeCopy("combinationDatesUpdated", locale, {
    start: md(range.startDate),
    end: md(range.endDate),
    days: range.days ?? "",
  });
}

const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const CN_MONTH_NUMBER: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
/** One month (zh / ja 「1月」「十二月」, ko 「1월」, en "January"). */
const MONTH_TOKEN_RE =
  /(\d{1,2}|十[一二]?|[一二三四五六七八九])\s*月(?:份|初|中旬|上旬|下旬|中|底)?|(\d{1,2})\s*월|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
/** Change wording / filler around a month-only reply (zh / en / ja / ko). */
const MONTH_ONLY_FILLER_RE =
  /^(?:(?:sorry|actually|ok(?:ay)?|then|no|let['’]?s|please|make\s+it|change\s+(?:it|the\s+month|the\s+trip)?\s*to|switch\s+(?:it\s+)?to|move\s+(?:it\s+)?to|go\s+in|in|instead|那|那就|還是|还是|我想|我要|想|要|改成|改到|改為|改为|改在|換成|换成|換到|换到|改|出發|出发|去|吧|好了|了|に変更(?:して)?(?:ください)?|に変え(?:て)?(?:ください)?|にして(?:ください)?|にします|へ変更|でお願いします|(?:으)?로\s*(?:바꿔|바꿔\s*줘|바꿔\s*주세요|변경|하자|할게요?|해\s*줘|해\s*주세요)|에\s*갈게요?)[\s,，、.。!！]*)+$/i;

/** Month number (1–12) of a month-only reply, else undefined. */
function monthOnlyNumber(text: string): number | undefined {
  const t = normalize(text);
  const m = t.match(MONTH_TOKEN_RE);
  if (!m || m.index == null) return undefined;
  const rest = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`.replace(/[\s,，、.。!！]+/g, " ").trim();
  if (rest && !MONTH_ONLY_FILLER_RE.test(rest)) return undefined;
  const n = m[1] ? (CN_MONTH_NUMBER[m[1]] ?? Number(m[1])) : m[2] ? Number(m[2]) : EN_MONTHS.indexOf((m[3] ?? "").toLowerCase()) + 1;
  return n >= 1 && n <= 12 ? n : undefined;
}

/**
 * 「改成1月」"make it January"「1月に変更」「1월로 바꿔」while choosing combinations: only a month
 * (plus change wording) — a travel-month change, never a combination id (「1月」is not combination 1).
 */
export function isCombinationMonthOnlyReply(text: string): boolean {
  if (parseTravelDateRangeFromText(text).startDate) return false;
  return monthOnlyNumber(text) != null;
}

/** Acknowledges the new travel month; the caller keeps the combination_choice pending. */
export function combinationMonthUpdatedCopy(text: string, locale: Locale): string {
  const n = monthOnlyNumber(text) ?? 1;
  const month = locale === "en"
    ? EN_MONTHS[n - 1]!.replace(/^./, (c) => c.toUpperCase())
    : locale === "ko" ? `${n}월` : `${n}月`;
  return chatRuntimeCopy("combinationMonthUpdated", locale, { month });
}

/**
 * 「改成12月」on a 12/10–12/14 trip: the stated month is the trip dates' own month — nothing
 * changed; the copy says the dates stay. Undefined when the month differs (or no dates).
 */
export function combinationMonthUnchangedCopy(
  text: string,
  locale: Locale,
  startDate?: string,
  endDate?: string,
): string | undefined {
  const n = monthOnlyNumber(text);
  const start = startDate?.match(/^\d{4}-(\d{2})-(\d{2})$/);
  const end = endDate?.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (n == null || !start || !end || Number(start[1]) !== n) return undefined;
  const month = locale === "en"
    ? EN_MONTHS[n - 1]!.replace(/^./, (c) => c.toUpperCase())
    : locale === "ko" ? `${n}월` : `${n}月`;
  return chatRuntimeCopy("combinationMonthUnchanged", locale, {
    month,
    start: `${Number(start[1])}/${Number(start[2])}`,
    end: `${Number(end[1])}/${Number(end[2])}`,
  });
}

/** Follow-up question; the caller keeps the combination_choice pending. */
export function combinationPartialModifyFollowUp(text: string, locale: Locale): string {
  // 「第二天不用改，但第三天換一下」→ day 3 (the deciding clause); an unnamed day → generic copy.
  const day = parseDayOrdinalFromText(decidingDayClause(normalize(text)));
  return day
    ? chatRuntimeCopy("combinationPartialModifyDay", locale, { day })
    : chatRuntimeCopy("combinationPartialModify", locale);
}
