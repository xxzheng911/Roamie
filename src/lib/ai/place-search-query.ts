import {
  extractKnownDestinationFromText,
  normalizeDestination,
} from "@/lib/ai/normalize-destination";

export function buildPlaceSearchQuery(opts: {
  destination?: string | null;
  mood?: string | null;
  interests?: string[];
  userText?: string;
}): string {
  const fromText = opts.userText ? extractKnownDestinationFromText(opts.userText) : undefined;
  const dest =
    normalizeDestination(opts.destination) ??
    fromText ??
    extractKnownDestinationFromText(opts.destination ?? "");

  if (dest) {
    const t = opts.userText ?? "";
    if (/(咖啡|caf[eé])/i.test(t) || opts.interests?.includes("咖啡") || /咖啡/.test(opts.mood ?? "")) {
      return `${dest} 咖啡`;
    }
    if (/(美食|餐廳|小吃|吃)/.test(t) || opts.interests?.includes("美食")) {
      return `${dest} 美食`;
    }
    if (/(拍照|打卡|攝影)/.test(t) || opts.interests?.includes("拍照")) {
      return `${dest} 拍照景點`;
    }
    if (/(夜景|晚上|深夜)/.test(t) || opts.interests?.includes("夜景")) {
      return `${dest} 夜景`;
    }
    return `${dest} 景點`;
  }

  const mood = opts.mood?.trim();
  if (mood?.includes("咖啡")) return "cafe coffee";
  if (opts.interests?.includes("美食")) return "restaurant local food";
  return "nearby places";
}
