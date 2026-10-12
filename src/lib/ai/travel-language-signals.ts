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
    && !/ignore|instruction|system|prompt|https?|明年|今年|来年|내년|next |month|days?|weeks?|weather|旅行|行程|推薦|recommend|please|thank|hello|你好/i.test(text);
}
export function travelDestinationCandidates(input: string): string[] {
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
  // 「Tokyo 11/25-11/30」: the remainder after the dates is the bare destination text.
  if (!raw && dated && safeDestinationCandidate(text)) raw = text;
  if (!raw && /[+＋]|\s+(?:and|と|및)\s+/.test(text)) raw = text;
  if (!raw) return [];
  raw = raw.replace(/\s+(?:in|for|this|next)\b.*$/i, '').replace(/[.!?。！]+$/, '').trim();
  const parts = raw.split(/\s*[+＋]\s*|\s+(?:and|と|및)\s+/).map(x => x.trim());
  return parts.length <= 5 && parts.every(safeDestinationCandidate) ? parts : [];
}
