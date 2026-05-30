import type { ChatPlanningSession } from "@/lib/chat-session";
import { parseTravelContextFromText } from "@/lib/ai/travel-context";

/** 輕量 hint，避免 instant-reply 依賴 user-intent */
export type TravelAdviceHint = {
  destination?: string;
  travelMonth?: string;
};

const MONTH_CLIMATE: Record<string, Record<string, string>> = {
  釜山: {
    "11月":
      "11 月釜山約 8–18°C，早晚偏涼、午間溫和，降雨不多但海邊風大。建議薄長袖＋可脫的防風外套、長褲與好走的鞋；想看海記得加一層。",
    "12月": "12 月釜山偏冷乾燥，約 3–12°C，海風明顯。建議保暖外套、圍巾，行程可混合室內市場與海景。",
    "3月": "3 月釜山仍偏涼，約 6–14°C，偶有雨。建議洋裝外搭外套、雨傘，櫻花季前後可安排海雲台或甘川洞。",
  },
  京都: {
    "11月": "11 月京都約 8–17°C，紅葉季尾聲，早晚冷。建議薄羽絨或大衣、圍巾，景點步行多，鞋款要舒服。",
  },
  大阪: {
    "11月": "11 月大阪約 9–18°C，比夏天乾爽許多。薄長袖＋輕外套即可，偶爾小雨帶折疊傘。",
  },
  東京: {
    "11月": "11 月東京約 10–18°C，秋末偏乾。洋裝式分層穿搭最實用，傍晚會再降溫。",
  },
  沖繩: {
    "11月": "11 月沖繩約 18–25°C，仍偏暖但晚上海風大。短袖＋薄外套即可，下水機會變少。",
  },
};

function normalizeCity(name?: string | null): string | undefined {
  const raw = name?.trim().replace(/(市|縣|都|府|道)$/u, "");
  return raw || undefined;
}

function asksWeather(text: string): boolean {
  return /(天氣|氣候|溫度|冷不冷|熱不熱|會冷|會熱|下雨|降雨|穿什麼)/.test(text);
}

/** AI 無回應時，為旅行時間／天氣詢問提供可讀的本地 fallback */
export function buildTravelAdviceFallbackReply(
  userText: string,
  session: ChatPlanningSession,
  intent?: TravelAdviceHint,
): string {
  const parsed = parseTravelContextFromText(userText, session);
  const destination =
    normalizeCity(intent?.destination) ??
    normalizeCity(parsed.destination) ??
    normalizeCity(session.tripDestination?.city) ??
    normalizeCity(session.preferredArea);
  const month = intent?.travelMonth ?? parsed.travelMonth;

  if (asksWeather(userText)) {
    if (destination && month && MONTH_CLIMATE[destination]?.[month]) {
      return MONTH_CLIMATE[destination][month];
    }
    if (destination && month) {
      return `${month}前往${destination}，建議出發前再確認一週預報；一般來說這時段適合洋裝式分層（薄長袖＋外套），並預留室內外溫差。若需要，我可以再幫你排幾個適合這個季節的景點。`;
    }
    if (destination) {
      return `${destination}的天氣會依月份差很多；你可以告訴我想去的月份，我再幫你整理氣溫、降雨和穿著建議。`;
    }
    return "你想問哪個城市、哪個月份的天氣呢？告訴我目的地和時間，我可以幫你整理氣溫範圍和穿著建議。";
  }

  if (destination && month) {
    return `${month}去${destination}通常是好安排行程的時段之一。若你告訴我預計待幾天、偏好放鬆或美食，我可以幫你抓幾個適合的區域和路線。`;
  }
  if (destination) {
    return `若你打算去${destination}，可以跟我說月份、天數和旅伴，我會依季節幫你建議什麼時候去最舒服。`;
  }
  return "你可以告訴我想去的城市、月份或天數，我會依季節和天氣幫你整理建議。";
}

const GENERIC_REPLY_PREFIXES = [
  "你想問哪個城市",
  "你可以告訴我想去的城市",
  "你可以告訴我",
];

/** 有足夠脈絡時可直接回覆，不必等 OpenAI */
export function tryLocalTravelAdviceReply(
  userText: string,
  session: ChatPlanningSession,
  intent?: TravelAdviceHint,
): string | null {
  const reply = buildTravelAdviceFallbackReply(userText, session, intent);
  if (GENERIC_REPLY_PREFIXES.some((p) => reply.startsWith(p))) return null;
  return reply;
}

function matchesTravelTimeAdvicePatterns(t: string): boolean {
  return (
    /(旅行時間|行程時間|什麼時候去|何時去|適合去嗎|適不適合去|適合嗎|去幾天|玩幾天|待幾天|安排幾天|幾天夠|幾天比較|待多久|要待多久)/.test(
      t,
    ) ||
    /(天氣|氣候|溫度|冷不冷|熱不熱|會冷|會熱|穿什麼).{0,12}(怎麼樣|如何|好不好)/.test(t) ||
    /(推薦|建議).{0,8}(時間|幾天|天數|什麼時候)/.test(t) ||
    /(時間|幾天|天數|什麼時候).{0,8}(推薦|建議)/.test(t) ||
    (/\d{1,2}\s*月/.test(t) &&
      /(去|玩|旅行|旅遊|行程|天氣|氣候)/.test(t) &&
      /(推薦|建議|適合|時間|幾天|天數|嗎|怎麼樣|如何|安排|規劃)/.test(t))
  );
}

/** 旅行時間／天氣詢問（無 user-intent 依賴，供 chat-instant-reply / verify 使用） */
export function userAsksTravelTimeAdviceText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return matchesTravelTimeAdvicePatterns(t);
}

export function buildTravelAdviceHint(
  userText: string,
  session: ChatPlanningSession,
): TravelAdviceHint {
  const parsed = parseTravelContextFromText(userText, session);
  const month = userText.match(/(\d{1,2})\s*月/)?.[1];
  return {
    destination: parsed.destination,
    travelMonth: parsed.travelMonth ?? (month ? `${Number.parseInt(month, 10)}月` : undefined),
  };
}
