import type { Locale } from './types';
export const planningContextCopy: Record<Locale, {country: string; month: string; cityQuestion: string; unavailable: string}> = {
 'zh-TW': {country:'我們來規劃{destination}的旅行。',month:'已記下{destination}，{month}出發；實際日期尚未確定。',cityQuestion:'你比較想去哪個城市或地區？',unavailable:'目前暫時無法取得{destination}的實際地點組合，請稍後重新整理推薦。'},
 en: {country:'Let’s plan your trip to {destination}.',month:'I’ve noted {destination} in {month}; exact travel dates are still open.',cityQuestion:'Which city or area would you like to visit?',unavailable:'I couldn’t get suitable place combinations for {destination} right now. Please refresh the recommendations later.'},
 ja: {country:'{destination}への旅行を計画しましょう。',month:'{month}の{destination}旅行として控えました。具体的な日程はまだ未定です。',cityQuestion:'どの都市やエリアに行きたいですか？',unavailable:'現在、{destination}の実際のスポットを組み合わせた提案を取得できません。後ほどおすすめを更新してください。'},
 ko: {country:'{destination} 여행을 계획해 봐요.',month:'{month}의 {destination} 여행으로 기억할게요. 정확한 날짜는 아직 미정이에요.',cityQuestion:'어느 도시나 지역을 방문하고 싶으세요?',unavailable:'지금은 {destination}의 실제 장소를 조합한 추천을 가져올 수 없어요. 잠시 후 추천을 새로고침해 주세요.'},
};
export function planningContextText(key: keyof typeof planningContextCopy.en, locale: Locale, destination: string, month?: number): string {
 const monthLabel = month ? new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2000,month-1,1))) : '';
 return planningContextCopy[locale][key].replace('{destination}',destination).replace('{month}',monthLabel);
}
