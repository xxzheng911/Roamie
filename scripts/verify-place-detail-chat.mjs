import { RoamieRecommendationItem } from "../src/lib/ai/types.ts";
import {
  buildPlaceDetailReply,
  enterPlaceDetailChat,
  isPlaceDetailChatActive,
  parsePlaceDetailFollowUp,
} from "../src/lib/ai/place-detail-chat.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";
import { roamieRecToChatItem } from "../src/lib/chat-session.ts";
import { recommendationsForChatDisplay } from "../src/lib/chat-display-recommendations.ts";

const sampleRec: RoamieRecommendationItem = {
  name: "愛河親水徒步區",
  placeName: "愛河親水徒步區",
  type: "景點",
  address: "高雄市鹽埕區",
  lat: 22.62,
  lng: 120.28,
  reason: "適合晚上沿河散步、看夜景。",
  description: "河岸步道",
  estimatedTime: "45 分鐘",
};

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

const session = enterPlaceDetailChat(
  {
    ...createEmptySession(),
    mood: "深夜散步",
    selectedMood: "深夜散步",
    fromMoodFlow: true,
    conversationMode: "mood_recommend",
  },
  roamieRecToChatItem(sampleRec),
);

assert(isPlaceDetailChatActive(session), "place detail session is active");
assert(session.conversationMode === "place_focus", "conversation mode is place_focus");
assert(session.placeDetailFocus?.name === "愛河親水徒步區", "selected place saved on session");
assert(session.previousConversationMode === "mood_recommend", "previous mode preserved");

const reply = buildPlaceDetailReply(session.placeDetailFocus!, session);
assert(reply.includes("愛河親水徒步區"), "reply mentions place name");
assert(reply.includes("深夜散步"), "reply references mood context");
assert(reply.includes("40～60 分鐘") || reply.includes("45"), "reply suggests stay duration");
assert(!reply.includes("幫你找了"), "reply does not look like batch recommendation");

const discussCards = recommendationsForChatDisplay(session, "想聊聊 愛河親水徒步區", [
  sampleRec,
  { ...sampleRec, name: "另一個地點" },
]);
assert(discussCards.length === 0, "place detail discuss does not render duplicate cards");

const cafeCards = recommendationsForChatDisplay(session, "附近有咖啡廳嗎", [sampleRec]);
assert(cafeCards.length > 0, "explicit nearby cafe request can still show cards");

assert(parsePlaceDetailFollowUp("加入行程") === "add_to_trip", "parses add to trip");
assert(parsePlaceDetailFollowUp("附近有咖啡廳嗎") === "nearby_cafe", "parses nearby cafe");

if (failed > 0) process.exit(1);
console.log("\nAll place detail chat checks passed.");
