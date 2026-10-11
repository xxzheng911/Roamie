import { travelMonthSignal } from './travel-language-signals';
/** Uses the caller clock; destination timezone only when it is an Intl-valid timezone. No dates invented. */
export function planningCalendarSignals(text: string, now = new Date(), timezone?: string) {
  let year = now.getFullYear();
  if (timezone) {
    try { year = Number(new Intl.DateTimeFormat('en', {year:'numeric', timeZone:timezone}).format(now)); } catch { /* offset is not timezone authority */ }
  }
  const month = travelMonthSignal(text);
  const next = /\bnext\b|明年|来年|내년/i.test(text);
  const explicit = text.match(/\b(20\d{2})\s*(?:年|년)/)?.[1];
  const seasons = ['spring','summer','autumn','winter'] as const;
  const patterns = [/spring|春|봄/i,/summer|夏|여름/i,/autumn|fall|秋|가을/i,/winter|冬|겨울/i];
  return {
    ...(month ? {travelMonth: month} : {}),
    ...(explicit ? {travelYear:Number(explicit)} : next ? {travelYear:year+1} : /今年|今年|올해|this year/i.test(text) ? {travelYear:year} : {}),
    ...(patterns.some(p => p.test(text)) ? {travelSeason: seasons[patterns.findIndex(p => p.test(text))]} : {}),
  };
}
export function isCalendarOnly(text: string): boolean {
  return /^(?:(?:next|this)\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|fall|winter)[.!]?$/i.test(text.trim())
    || /^(?:明年|今年|後年|来年|내년|올해)?\s*(?:\d{1,2}|[一二三四五六七八九十]+)\s*(?:月|월)$/.test(text.trim());
}
