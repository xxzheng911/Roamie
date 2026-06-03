import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 靜態檢查：send() 在 context merge 後會走 priority instant + date fallback */
export function chatSendWiresDateRecommendationReply(): boolean {
  const src = readFileSync(join(__dirname, "../../routes/_app.chat.tsx"), "utf8");
  return (
    src.includes('path: "priority_instant"') &&
    src.includes("answer_date_recommendation") &&
    src.includes("buildDateRangeRecommendationReply") &&
    src.includes("[CHAT_MESSAGES_RENDERED]") &&
    src.includes("buildSafeItineraryGeneratorPayload")
  );
}
