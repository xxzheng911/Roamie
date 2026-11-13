import { stripTravelDateRangeFromText } from "@/lib/ai/parse-travel-date-range";
/** Lexical signals only; all locales use the existing arbitration/planner. */
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export function travelMonthSignal(text: string): string | undefined {
  const english = months.findIndex(month => new RegExp(`\\b${month}\\b`, 'i').test(text));
  if (english >= 0) return `${english + 1}月`;
  const numeric = text.match(/(?:^|[^\d])(1[0-2]|0?[1-9])\s*(?:月|월)/);
  if (numeric) return `${Number(numeric[1])}月`;
  const chinese = text.match(/(十二|十一|十|[一二三四五六七八九])月/);
  if (chinese) return `${['','一','二','三','四','五','六','七','八','九','十','十一','十二'].indexOf(chinese[1])}月`;
  return undefined;
}
export const nearbyLanguageSignal = (text: string): boolean => /near me|nearby|附近|周辺|近く|근처|주변/i.test(text);
export function multilingualTravelIntent(text: string): boolean {
  if (/\b(?:not planning|no plans|used to|what is|tell me about|history of)\b|不想旅行|沒有旅行計畫|旅行しません|여행 안/i.test(text)) return false;
  if (nearbyLanguageSignal(text) || /\b(?:weather|temperature|what is|where is)\b|天氣|天气|天気|날씨/i.test(text)) return false;
  const purpose = /\b(?:plan(?:ning)?|thinking of|want to|would like to|(?:i['’]d|we['’]d) (?:love|like) to)\b/i;
  const travel = /\b(?:trip|itinerary|holiday|vacation|visit(?:ing)?|explore|travel(?:ling|ing)?)\b/i;
  return Boolean(travelMonthSignal(text) && /(?:要去|想去|去).+(?:玩|旅行|旅遊|旅游)/.test(text))
    || (purpose.test(text) && travel.test(text))
    || /\b(?:want|would like|hope) to go to\s+\S/i.test(text)
    || /(?:我)?(?:想去|要去).+/.test(text)
    || /\b(?:i['’]m|i am|we['’]re|we are)\s+(?:going|travell?ing)\s+to\s+\S/i.test(text)
    || /(?:想|要|考慮|計畫|規劃|安排).*(?:旅行|旅遊|自由行|度假|假期)/.test(text)
    || /(?:旅行|観光).*(?:したい|します|する|予定|計画)|(?:計画|予定).*旅行/.test(text)
    || /여행.*(?:계획|갈|가고|가요)|(?:계획|휴가).*여행/.test(text);
}
/** Bounded text candidate, never a verified geographic entity. */
export function safeDestinationCandidate(text: string): boolean {
  return text.length >= 2 && text.length <= 100 && /^[\p{L}\p{M}\s.'’\-]+$/u.test(text)
    && !/ignore|instruction|system|prompt|https?|明年|今年|来年|내년|next |month|days?|weeks?|weather|旅行|行程|推薦|recommend|please|thank|hello|你好/i.test(text)
    // 「改成四天」: a CJK-numeral trip length (as 「4天」 already fails the letters-only test); 四日市 stays.
    && !/[一二三四五六七八九十两兩]\s*(?:天|晚|日$)/u.test(text);
}
/** 「Sorry it's」「抱歉是」「改成」「죄송해요 이에요」: what is left of a date correction once the dates are stripped. */
export function isDateCorrectionRemainder(text: string): boolean {
  const rest = text
    .replace(/\b(?:sorry|it['’]?s|it is|actually|oops|oh|wait|no|change|the|dates?|to|make it|i mean|correction)\b/giu, '')
    .replace(/抱歉|不好意思|對不起|对不起|其實|其实|應該|应该|改成|改為|改为|改到|日期|更正|是|喔|啊|すみません|すいません|ごめんなさい|ごめん|実は|訂正|日程|変更|です|でした|죄송해요|죄송합니다|미안해요|미안|사실|정정|날짜|변경|이에요|예요|입니다/gu, '')
    .replace(/[\s.,'’!?、。，！？\-]/gu, '');
  return rest.length === 0;
}
/** Trip-type / time / generic nouns before ja / ko trip wording (「家族旅行」「海外へ旅行」「가족 여행」): never a place. */
const JA_KO_NON_PLACE_TRAVEL_NOUN_RE =
  /^(?:家族|友達|友人|一人|二人|卒業|修学|新婚|社員|会社|学校|出張|海外|国内|週末|来月|今月|来年|今年|年末|年始|正月|連休|弾丸|女子|温泉|旅行|観光|空港|病院|ホテル|コンビニ|トイレ|カップル|グルメ|가족|친구|혼자|졸업|수학|신혼|당일|해외|국내|주말|다음달|이번달|내년|올해|연말|연휴|방학|여름|겨울|커플|맛집|온천|바다|해변|산|카페|쇼핑|여행|관광|출장|공항|병원|학교|회사|호텔|편의점|화장실|놀러|한번|다시|같이|빨리|정말|진짜|언젠가|여기|거기|저기|어디|집에|휴가|여름휴가|겨울휴가|휴양|휴양지|캠핑|캠프|시골|고향|멀리|근처|시내|외국|데이트|가족여행|해외여행|국내여행|친구랑|친구들|친구들이랑|가족이랑|가족들|부모님|애인|등산|낚시|드라이브|소풍|놀이공원|워터파크|수영장|동물원|박물관|스키|골프|계곡|호수|섬|여름방학|겨울방학)$/u;
/** Korean names of KNOWN_CITIES / KNOWN_TOURIST_CITIES (trip-planning-context imports this module, so not imported). */
const KO_LISTED_CITY_RE =
  /^(?:서울|부산|제주|제주도|경주|강릉|도쿄|오사카|교토|나고야|후쿠오카|요코하마|삿포로|홋카이도|오키나와|나라|고베|홍콩|마카오|싱가포르|방콕|치앙마이|다낭|타이베이|파리|런던|뉴욕|시드니)$/u;
/**
 * 「シドニーへ旅行」「シドニーに旅行」「シドニー旅行」「シドニーに行きたい」「日本への旅行」「시드니 여행」「시드니에 가고 싶어」:
 * a whole turn that is only a ja / ko name + trip / wish wording names that place (as the dated form does).
 * The bare 「X旅行」 form is Katakana only (a Han 「X旅行」 is also zh: 「畢業旅行」).
 */
/** 「삿포로 가고 싶어」「삿포로 여행」: a lazy name drops a final 로 as a particle; a listed full name keeps it. */
function keepListedKoName(text: string, name: string | undefined): string | undefined {
  const head = text.trim().match(/^\p{Script=Hangul}{2,20}/u)?.[0];
  return name && head && head !== name && head.startsWith(name) && KO_LISTED_CITY_RE.test(head) ? head : name;
}
function jaKoTravelPhraseName(text: string): string | undefined {
  const t = text.trim().replace(/[.!！。]+$/u, '');
  let name = t.match(/^([\p{Script=Han}\p{Script=Katakana}ー・]{2,20}?)\s*(?:への|へ|に)(?:旅行|観光)(?:したい(?:です)?|します|する|中|に(?:行きたい(?:です)?|行きます|行く))?$/u)?.[1]
    ?? t.match(/^([\p{Script=Katakana}ー・]{2,20}?)(?:旅行|観光)(?:したい(?:です)?|します|する)?$/u)?.[1]
    ?? t.match(/^([\p{Script=Han}\p{Script=Katakana}ー・]{2,20}?)(?:へ|に)(?:行きたい(?:です)?|行きます|行く)$/u)?.[1]
    ?? t.match(/^(\p{Script=Hangul}{2,20}?)(?:\s*(?:으로|로)?\s*여행(?:\s*(?:가고\s*싶어(?:요)?|갈래(?:요)?))?|(?:에|으로|로)\s*(?:가고\s*싶어(?:요)?|가고\s*싶다|갈래(?:요)?))$/u)?.[1]
    // 「안동 3일 가고 싶어」「안동 2박 3일 가고 싶어」: name + required trip length + wish (a name never ends in 에).
    ?? t.match(/^(\p{Script=Hangul}{2,20}?)(?<!에)\s*(?:\d+\s*박\s*)?\d+\s*일\s*(?:에\s*)?(?:여행\s*)?(?:가고\s*싶어(?:요)?|가고\s*싶다|갈래(?:요)?|가려고(?:요)?|가자)$/u)?.[1]
    // 「부산 가고 싶어」: without a trip length only a listed city is a name (no geocode for an unknown one).
    ?? t.match(/^(\p{Script=Hangul}{2,20}?)(?<!에)\s+(?:가고\s*싶어(?:요)?|가고\s*싶다|갈래(?:요)?|가려고(?:요)?|가자)$/u)?.[1]?.match(KO_LISTED_CITY_RE)?.[0];
  // 「제주도도」「부산이랑」: drop one trailing 도 (only after 도) / 랑·이랑 particle, keeping at least 2 letters.
  name = keepListedKoName(t, name);
  const bare = name?.replace(/(?<=\p{Script=Hangul}도)도$|(?<=\p{Script=Hangul}{2})이?랑$/u, '');
  return bare && !JA_KO_NON_PLACE_TRAVEL_NOUN_RE.test(name!) && !JA_KO_NON_PLACE_TRAVEL_NOUN_RE.test(bare) ? bare : undefined;
}
export function travelDestinationCandidates(input: string, options: { acceptDatedRemainder?: (remainder: string) => boolean } = {}): string[] {
  // A date range is calendar data owned by parseTravelDateRangeFromText, never part of a name.
  const text = stripTravelDateRangeFromText(input);
  const dated = text !== input.trim();
  let raw: string | undefined;
  if (multilingualTravelIntent(text) || dated) {
    raw = text.match(/\b(?:going|go|travell?ing|travel|trip|holiday|vacation)\s+(?:to|in)\s+(.+)/i)?.[1]
      ?? text.match(/\b(?:visiting|visit|explore)\s+(.+)/i)?.[1]
      ?? text.match(/(?:想去|要去|去)\s*(.+?)(?:旅行|旅遊|玩|自由行|[。！]|$)/)?.[1]
      ?? text.match(/(?:安排|規劃)\s*(?:[一二三四五六七八九十\d]+週)?(.+?)(?:自由行|旅行)/)?.[1]
      ?? text.match(/(?:に|で)\s*(.+?)(?:へ|を)\s*(?:旅行|観光)/)?.[1]
      ?? text.match(/^(.+?)(?:へ|を)\s*(?:旅行|観光)/)?.[1]
      ?? text.match(/(?:에|봄에|겨울에)\s*(.+?)(?:(?:으로|로)\s*여행|\s+여행)/)?.[1]
      ?? text.match(/^(?:に|で)?\s*(.+?)(?:へ|に)\s*(?:行きます|行く|行きたい)/)?.[1]
      ?? text.match(/^(.+?)(?:(?:으로|로)\s*여행|\s+여행)/)?.[1];
  }
  if (!raw) raw = jaKoTravelPhraseName(text);
  raw = keepListedKoName(text, raw);
  // 「Tokyo 11/25-11/30」: the remainder after the dates is the bare destination text.
  // 「京都に12/10〜12/13」「교토에 …」: a trailing particle is not part of the name.
  // With a destination already set, the caller accepts only a known, different destination.
  if (!raw && dated && safeDestinationCandidate(text) && !isDateCorrectionRemainder(text)) {
    const bare = text.replace(/(?<=[\p{Script=Han}\p{Script=Katakana}])(?:に|へ|で)$|(?<=\p{Script=Hangul})(?:으로|에)$/u, '').trim() || text;
    if (!options.acceptDatedRemainder || options.acceptDatedRemainder(bare)) raw = bare;
  }
  if (!raw && /[+＋]|\s+(?:and|と|및)\s+/.test(text)) raw = text;
  if (!raw) return [];
  raw = raw.replace(/\s+(?:in|for|this|next)\b.*$/i, '').replace(/[.!?。！]+$/, '').trim();
  // 「安東 3 天」「安東三天」「Andong 3 days」「안동 3일」: a trailing trip length is never part of the name (bare 日 is a date).
  raw = raw.replace(/\s*(?:\d+|[一二三四五六七八九十兩两]+)\s*(?:天|日間|days?|일)\s*(?:左右|的?行程|的?旅行)?$/iu, '').trim();
  const parts = raw.split(/\s*[+＋]\s*|\s+(?:and|と|및)\s+/).map(x => x.trim());
  return parts.length <= 5 && parts.every(safeDestinationCandidate) ? parts : [];
}
