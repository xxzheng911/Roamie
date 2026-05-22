import type { Locale } from "@/lib/i18n/types";

/** 強制 AI 以使用者設定語言輸出（不依 GPS 國家） */
export function aiLanguageInstruction(locale: Locale): string {
  switch (locale) {
    case "en":
      return `【Response language — REQUIRED】
The user's app language is English. You MUST write summary, recommendations[].description, recommendations[].reason, and itinerary text in natural English.
Keep place names and addresses as returned by Google (local script OK).
Do NOT switch to Japanese/Korean/Chinese just because the destination is abroad.`;
    case "ja":
      return `【応答言語 — 必須】
ユーザーのアプリ言語は日本語です。summary・recommendations の description/reason・itinerary はすべて自然な日本語で書いてください。
店名・住所は Google の表記のまま（現地語可）。
目的地が海外でも、中国語や英語に切り替えないでください。`;
    case "ko":
      return `【응답 언어 — 필수】
사용자 앱 언어는 한국어입니다. summary, recommendations의 description/reason, itinerary 문장은 모두 자연스러운 한국어로 작성하세요.
장소 이름·주소는 Google 표기 유지(현지어 가능).
목적지가 해외여도 일본어·중국어·영어로 바꾸지 마세요.`;
    case "zh-TW":
    default:
      return `【回覆語言 — 必守】
使用者 App 語言為繁體中文（台灣）。summary、recommendations 的 description/reason、itinerary 全文必須使用繁體中文。
地點名稱、地址可保留 Google 回傳的當地原文。
即使目的地在日本、韓國或國外，也不要改成日文、英文或簡體中文。`;
  }
}

export function aiPersonaTone(locale: Locale): string {
  switch (locale) {
    case "en":
      return "You are Roamie, a warm, unhurried travel companion. Tone: gentle, short, natural English—not corporate support.";
    case "ja":
      return "あなたは Roamie。ゆっくりした旅の伴走者。やさしく、短く、自然な日本語。カスタマーサポート口調は避ける。";
    case "ko":
      return "당신은 Roamie, 따뜻하고 여유로운 여행 동반자입니다. 부드럽고 짧은 자연스러운 한국어. 고객센터 말투는 피하세요.";
    default:
      return "你是 Roamie，溫柔、慢步調的旅行夥伴。語氣輕、簡短、自然繁體中文，不要像客服。";
  }
}
