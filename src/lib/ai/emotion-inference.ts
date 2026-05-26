import type { ChatPlanningSession } from "@/lib/chat-session";
import type { WeatherSummary } from "@/lib/weather-types";

export type EmotionSignals = {
  energy?: "low" | "medium" | "high";
  social?: "alone" | "pair" | "group" | "unknown";
  setting?: "indoor" | "outdoor" | "either";
  pace?: "slow" | "active" | "unknown";
  wantsQuiet?: boolean;
  wantsLively?: boolean;
  crowdAverse?: boolean;
  nightOriented?: boolean;
  rainSensitive?: boolean;
  labels: string[];
};

function pushLabel(labels: string[], label: string): void {
  if (!labels.includes(label)) labels.push(label);
}

export function inferEmotionSignals(
  userText: string,
  session?: ChatPlanningSession,
  weather?: WeatherSummary | null,
): EmotionSignals {
  const t = userText.trim();
  const labels: string[] = [];
  const signals: EmotionSignals = { labels };

  if (/(累|疲|倦|沒力|想休息|不想動|好睏)/.test(t)) {
    signals.energy = "low";
    pushLabel(labels, "疲憊、需要輕鬆節奏");
  }
  if (/(開心|興奮|很有精神|想動)/.test(t)) {
    signals.energy = "high";
    pushLabel(labels, "精神不錯、可接受稍多動");
  }

  if (/(一個人|獨自|solo|自己走走)/i.test(t)) {
    signals.social = "alone";
    pushLabel(labels, "一個人");
  } else if (/(兩人|情侶|朋友一起|家人|我們)/.test(t)) {
    signals.social = "pair";
    pushLabel(labels, "有人同行");
  }

  if (/(安靜|靜|人少|幽靜|放空)/.test(t)) {
    signals.wantsQuiet = true;
    pushLabel(labels, "偏好安靜");
  }
  if (/(熱鬧|嗨|續攤|人多也 ok)/.test(t)) {
    signals.wantsLively = true;
    pushLabel(labels, "可接受熱鬧");
  }
  if (/(人多|太擠|吵|不想.*人)/.test(t)) {
    signals.crowdAverse = true;
    pushLabel(labels, "想避開人潮");
  }

  if (/(室內|冷氣|百貨|展覽)/.test(t) && /(想|要|偏好|適合)/.test(t)) {
    signals.setting = "indoor";
    pushLabel(labels, "偏向室內");
  }
  if (/(戶外|走走|散步|河邊|夜景)/.test(t)) {
    if (signals.setting !== "indoor") signals.setting = "outdoor";
    pushLabel(labels, "願意走走或戶外");
  }

  if (/(慢慢|慢一點|不趕|悠閒)/.test(t)) {
    signals.pace = "slow";
    pushLabel(labels, "慢節奏");
  }
  if (/(多走|緊湊|排滿)/.test(t)) {
    signals.pace = "active";
    pushLabel(labels, "節奏偏緊");
  }

  if (/(晚上|深夜|夜景|夜間)/.test(t) || session?.lateNightMode) {
    signals.nightOriented = true;
    pushLabel(labels, "夜晚時段");
  }

  const mood = session?.selectedMood ?? session?.mood ?? "";
  if (/下雨天|☔|雨/.test(mood) || /下雨|雨天/.test(t)) {
    signals.rainSensitive = true;
    pushLabel(labels, "下雨情境");
  }
  if (weather?.condition && /雨|雷/.test(weather.condition)) {
    signals.rainSensitive = true;
    pushLabel(labels, "目前天氣偏濕");
  }

  if (!labels.length && mood) pushLabel(labels, `心情：${mood}`);

  return signals;
}

export function formatEmotionSignalsForPrompt(signals: EmotionSignals): string {
  if (!signals.labels.length) return "（從最新訊息推測感受，勿假設過多）";
  const parts = [...signals.labels];
  if (signals.energy === "low") parts.push("建議：先陪伴、再收斂，勿硬推景點");
  if (signals.rainSensitive) parts.push("建議：優先室內、有氛圍、可慢慢逛");
  if (signals.social === "alone" && signals.wantsQuiet)
    parts.push("建議：安靜、可獨處、夜景或河邊優先於排隊熱點");
  return parts.join("；");
}
