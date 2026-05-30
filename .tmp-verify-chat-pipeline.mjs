
import {
  resolveInstantChatReply,
  userAsksDestinationItineraryAdvice,
} from "../src/lib/chat/chat-pipeline.ts";
import { userAsksTravelTimeAdvice } from "../src/lib/ai/user-intent.ts";
import { parseTravelContextFromText } from "../src/lib/ai/travel-context.ts";

const session = {
  selectedPlaces: [],
  location: { lat: 22.64, lng: 120.29, city: "高雄" },
};

const cases = [
  { id: "A", text: "11月釜山天氣如何", expectIncludes: ["釜山", "11"] },
  {
    id: "B",
    text: "11月釜山行程你覺得怎麼安排比較好",
    expectIncludes: ["釜山", "11"],
  },
  { id: "C", text: "我今天有點累", expectInstant: false },
  { id: "D", text: "想找安靜的咖啡廳", expectInstant: false },
  { id: "E", text: "下雨天可以去哪", expectInstant: false },
];

let failed = 0;
for (const c of cases) {
  const parsed = parseTravelContextFromText(c.text, session);
  const instant = resolveInstantChatReply(c.text, session);
  const travel = userAsksTravelTimeAdvice(c.text);
  const itinerary = userAsksDestinationItineraryAdvice(c.text);
  console.log("[QA]", c.id, {
    text: c.text,
    destination: parsed.destination ?? null,
    travelMonth: parsed.travelMonth ?? null,
    userAsksTravelTimeAdvice: travel,
    userAsksDestinationItineraryAdvice: itinerary,
    instant: instant?.summary?.slice(0, 60) ?? null,
  });
  if (c.expectInstant === false) {
    if (instant) {
      console.error("[QA_FAIL]", c.id, "expected no instant reply");
      failed++;
    }
    continue;
  }
  if (!instant?.summary?.trim()) {
    console.error("[QA_FAIL]", c.id, "missing instant reply");
    failed++;
    continue;
  }
  for (const needle of c.expectIncludes ?? []) {
    if (!instant.summary.includes(needle)) {
      console.error("[QA_FAIL]", c.id, "missing", needle);
      failed++;
    }
  }
}
if (failed > 0) {
  console.error("[QA] failed cases:", failed);
  process.exit(1);
}
console.log("[QA] all chat pipeline checks passed");
