/**
 * Acceptance: Tokyo trip completed → return to chat → "我下個月要去台東"
 * must create a NEW trip planning session and must NOT reuse Tokyo dates.
 */
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import {
  isNewTripPlanning,
  maybeResetForNewTripPlanning,
  parseTravelMonthFromText,
  resetTripPlanningContext,
} from "../src/lib/ai/trip-planning-session-reset.ts";
import { processAdviceTurn } from "../src/lib/ai/chat-state-machine.ts";
import { detectChatIntent } from "../src/lib/ai/chat-intent.ts";

let failed = 0;

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

function tokyoCompletedSession() {
  return {
    ...createEmptySession(),
    phase: "done",
    planningSessionId: "plan-tokyo-old",
    travelDate: "2027-03-15",
    tripStartDate: "2027-03-15",
    tripEndDate: "2027-03-20",
    tripDays: 6,
    tripDestination: {
      placeId: "tokyo",
      country: "日本",
      city: "東京",
      lat: 35.68,
      lng: 139.76,
      formattedName: "東京",
      displayLabel: "東京",
    },
    weather: { condition: "晴", tempC: 18 },
    draftTrip: { id: "trip-tokyo", title: "東京 6 天" },
    currentDayPlan: { days: [], planningSessionId: "plan-tokyo-old", items: [{ name: "渋谷" }] },
    recommendedPlaces: [{ name: "渋谷", type: "attraction" }],
    selectedPlaces: [{ name: "渋谷", type: "attraction" }],
    pendingQuestion: {
      type: "combination_choice",
      options: ["經典", "美食"],
      baseDestination: "東京",
      destinationCountry: "日本",
    },
    travelContext: {
      interests: ["咖啡", "拍照"],
      excludedCategories: ["辣"],
      destination: "東京",
      destinationCountry: "日本",
      destinationCity: "東京",
      destinationType: "city",
      travelMonth: "3月",
      travelYear: 2027,
      startDate: "2027-03-15",
      endDate: "2027-03-20",
      days: 6,
      planningDaysConfirmed: true,
      selectedCombinationIds: [1, 2],
      selectedCombinationPlaceNames: ["渋谷", "浅草"],
      offeredCombinations: [
        { id: 1, title: "經典", places: [{ name: "渋谷", searchQuery: "渋谷", sourceCombinationId: 1, resolutionStatus: "named" }] },
      ],
      mustVisitGenerated: true,
      planningStage: "recommendations_generated",
      conversationState: "ready_for_itinerary",
      tripPurpose: "trip_style_selected",
      selectedTripStyle: "經典景點",
      planningTripStyle: "classic_landmarks",
      weather: { condition: "晴", tempC: 18 },
    },
    tripPlanningContext: {
      destination: "東京",
      startDate: "2027-03-15",
      endDate: "2027-03-20",
      days: 6,
      travelMonth: "3月",
      selectedPlaces: ["渋谷"],
      intent: "destination_planning",
    },
  };
}

console.log("=== isNewTripPlanning: 東京 → 台東 ===\n");

const tokyo = tokyoCompletedSession();
const detected = isNewTripPlanning(tokyo, "我下個月要去台東");
check(detected.isNew === true, "isNewTripPlanning=true");
check(detected.reason === "destination_changed", `reason=${detected.reason}`);
check(detected.incomingDestination === "台東", `incomingDestination=${detected.incomingDestination}`);

const expectedMonth = parseTravelMonthFromText("我下個月要去台東");
check(Boolean(expectedMonth), `travelMonth from 下個月=${expectedMonth}`);

console.log("\n=== resetTripPlanningContext clears Tokyo residue ===\n");

const reset = resetTripPlanningContext(tokyo, {
  reason: "destination_changed",
  incomingDestination: "台東",
  incomingTravelMonth: expectedMonth,
  userText: "我下個月要去台東",
});

check(reset.planningSessionId !== "plan-tokyo-old", `new planningSessionId=${reset.planningSessionId}`);
check(reset.travelContext?.destination === "台東", "destination=台東");
check(reset.travelContext?.startDate == null, `travelDate/startDate=null (got ${reset.travelContext?.startDate})`);
check(reset.travelContext?.endDate == null, `endDate=null (got ${reset.travelContext?.endDate})`);
check(reset.travelDate == null, `root travelDate=null`);
check(reset.tripStartDate == null, `root tripStartDate=null`);
check(reset.tripEndDate == null, `root tripEndDate=null`);
check(reset.tripDays == null, `tripDays=null (got ${reset.tripDays})`);
check(reset.travelContext?.days == null, `context.days=null`);
check(
  !reset.travelContext?.selectedCombinationIds?.length,
  "selectedCombinationIds=[]",
);
check(reset.travelContext?.offeredCombinations == null, "offeredCombinations cleared");
check(reset.draftTrip == null, "draftTrip cleared");
check(reset.currentDayPlan == null, "currentDayPlan cleared");
check(reset.pendingQuestion == null, "pendingQuestion cleared");
check(reset.weather == null, "weather cleared");
check(reset.recommendedPlaces.length === 0, "recommendedPlaces cleared");
check(reset.travelContext?.interests?.includes("咖啡"), "keeps Plus Memory interest 咖啡");
check(reset.travelContext?.interests?.includes("拍照"), "keeps Plus Memory interest 拍照");
check(reset.travelContext?.excludedCategories?.includes("辣"), "keeps 不吃辣 preference");
check(reset.travelContext?.travelMonth === expectedMonth, `travelMonth=${reset.travelContext?.travelMonth}`);
check(reset.phase !== "done", `phase reset from done → ${reset.phase}`);

console.log("\n=== mergeTravelContext must not revive Tokyo dates ===\n");

const merged = mergeTravelContext(tokyo, "我下個月要去台東");
check(merged.context.destination === "台東", `merged destination=${merged.context.destination}`);
check(merged.context.startDate == null, `merged startDate=null (got ${merged.context.startDate})`);
check(merged.context.endDate == null, `merged endDate=null (got ${merged.context.endDate})`);
check(merged.context.days == null, `merged days=null (got ${merged.context.days})`);
check(merged.session.tripDays == null, `merged session.tripDays=null (got ${merged.session.tripDays})`);
check(merged.session.tripStartDate == null, "merged session.tripStartDate=null");
check(merged.session.tripEndDate == null, "merged session.tripEndDate=null");
check(
  !merged.context.selectedCombinationIds?.length,
  "merged selectedCombinationIds empty",
);
check(
  merged.session.planningSessionId !== "plan-tokyo-old",
  `merged new sessionId=${merged.session.planningSessionId}`,
);
check(merged.context.travelMonth === expectedMonth, `merged travelMonth=${merged.context.travelMonth}`);
check(
  !/2027-03-15|2027\/03\/15/.test(JSON.stringify(merged.context)),
  "no Tokyo date residue in context JSON",
);

console.log("\n=== advice turn must not show Tokyo tentative dates ===\n");

const intent = detectChatIntent("我下個月要去台東");
const nextSession = {
  ...merged.session,
  activeChatIntent:
    intent === "destination_advice" ? "destination_advice" : merged.session.activeChatIntent,
  conversationMode:
    intent === "destination_advice" ? "destination_planning" : merged.session.conversationMode,
};
const turn = processAdviceTurn("我下個月要去台東", nextSession, merged.context);
const reply = turn.advice?.reply ?? turn.route?.question ?? "";
check(Boolean(reply), "has advice reply");
check(!/2027\/03\/15|2027-03-15|2027\/03\/20/.test(reply), "reply has no Tokyo dates");
check(!/暫定旅行日期：2027/.test(reply), "reply has no stale tentative Tokyo range");

// Days missing → should ask date/days, not invent 6-day Tokyo window.
check(
  /幾天|天數|日期|哪幾天|什麼時候|预计|預計/.test(reply) ||
    turn.session.pendingQuestion?.type === "ask_days" ||
    turn.advice?.pendingQuestion?.type === "ask_days" ||
    merged.context.days == null,
  "asks for date/days or leaves days null",
);

console.log("\n=== country→city refinement is NOT a new trip ===\n");

const japanSession = {
  ...createEmptySession(),
  planningSessionId: "plan-japan",
  travelContext: {
    interests: [],
    destination: "日本",
    destinationCountry: "日本",
    destinationType: "country",
  },
};
const refine = isNewTripPlanning(japanSession, "我想去東京");
check(refine.isNew === false, `日本→東京 is refinement (isNew=${refine.isNew})`);

console.log("\n=== 大阪 → 東京 IS a new trip ===\n");

const osakaSession = {
  ...createEmptySession(),
  planningSessionId: "plan-osaka",
  tripDays: 3,
  tripStartDate: "2026-08-01",
  tripEndDate: "2026-08-03",
  travelContext: {
    interests: [],
    destination: "大阪",
    destinationCountry: "日本",
    destinationCity: "大阪",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    days: 3,
  },
};
const osakaToTokyo = isNewTripPlanning(osakaSession, "改去東京");
check(osakaToTokyo.isNew === true, `大阪→東京 isNew=${osakaToTokyo.isNew}`);

const osakaReset = maybeResetForNewTripPlanning(osakaSession, "改去東京");
check(osakaReset.didReset, "大阪→東京 didReset");
check(osakaReset.session.tripDays == null, "大阪 dates cleared");
check(osakaReset.session.travelContext?.destination === "東京", "destination=東京");

console.log("\n=== same city, new month clears old dates ===\n");

const taitungJuly = {
  ...createEmptySession(),
  planningSessionId: "plan-taitung-july",
  tripDays: 4,
  tripStartDate: "2026-07-01",
  tripEndDate: "2026-07-04",
  travelContext: {
    interests: ["慢旅行"],
    destination: "台東",
    destinationCountry: "台灣",
    travelMonth: "7月",
    startDate: "2026-07-01",
    endDate: "2026-07-04",
    days: 4,
  },
};
const monthShift = isNewTripPlanning(taitungJuly, "改成下個月去");
check(monthShift.isNew === true, `month change isNew=${monthShift.isNew}`);
check(monthShift.reason === "travel_month_changed", `month reason=${monthShift.reason}`);
const monthMerged = mergeTravelContext(taitungJuly, "我下個月要去台東");
check(monthMerged.context.startDate == null, "month change clears startDate");
check(monthMerged.context.days == null, "month change clears days");
check(monthMerged.context.travelMonth === expectedMonth, "month updated to 下個月");
check(
  monthMerged.session.planningSessionId !== "plan-taitung-july",
  "month change creates new session id",
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll new-trip session checks passed.");
