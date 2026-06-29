/** 心情／附近放鬆：口語「安排輕鬆行程」≠ 多日 CREATE_ITINERARY */
export function isMoodNearbyRelaxationRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\d+\s*天/.test(t)) return false;

  const moodRelax = /(想放空|放鬆|輕鬆|療癒|慢慢|散心)/.test(t);
  const walkRelax = /(散步|走走|溜達|闲逛|閒逛)/.test(t);
  const softItinerary =
    /(安排.{0,10}(輕鬆|放鬆)?.{0,6}行程|幫我安排一段|安排一段)/.test(t);

  if ((moodRelax || walkRelax) && softItinerary) return true;
  if (moodRelax && /幫我安排/.test(t) && !/(去|到)[\u4e00-\u9fffA-Za-z]{2,}/.test(t)) {
    return true;
  }
  return false;
}
