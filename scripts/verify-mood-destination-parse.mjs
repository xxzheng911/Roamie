import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { parseDestinationFromText } from "../src/lib/ai/trip-planning-context.ts";
import { applyTripIntentToSession } from "../src/lib/recommendation/trip-intent.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

const moodPrompt = "我想深夜散步，幫我看看附近適合去哪裡。";

let failed = 0;

if (parseDestinationFromText(moodPrompt) != null) {
  console.error("FAIL parseDestinationFromText should not return 哪裡");
  failed += 1;
} else {
  console.log("OK parseDestinationFromText ignores mood question prompt");
}

const moodSession = {
  ...createEmptySession(),
  fromMoodFlow: true,
  fromMoodCard: true,
  mood: "深夜散步",
  selectedMood: "深夜散步",
  homeMoodShortcutEntry: true,
};

const merged = mergeTravelContext(moodSession, moodPrompt);
if (merged.context.destination === "哪裡" || merged.session.preferredArea === "哪裡") {
  console.error("FAIL mergeTravelContext stored 哪裡 as destination", merged.context);
  failed += 1;
} else {
  console.log("OK mergeTravelContext mood flow has no bogus destination");
}

const applied = applyTripIntentToSession(moodPrompt, moodSession);
if (applied.tripDestination?.city === "哪裡" || applied.preferredArea === "哪裡") {
  console.error("FAIL applyTripIntentToSession stored 哪裡", applied);
  failed += 1;
} else {
  console.log("OK applyTripIntentToSession mood flow has no bogus destination");
}

const tokyoTrip = parseDestinationFromText("我想去東京五天");
if (tokyoTrip !== "東京") {
  console.error("FAIL parseDestinationFromText should still parse 東京, got", tokyoTrip);
  failed += 1;
} else {
  console.log("OK parseDestinationFromText still parses real destinations");
}

if (failed > 0) {
  process.exit(1);
}

console.log("\nAll mood destination parsing checks passed.");
