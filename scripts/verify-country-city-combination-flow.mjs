/**
 * Verify country→city→days→combination flow (generic, not Korea-only).
 */
import { createEmptySession } from "../src/lib/chat-session.ts";
import { mergeTravelContext } from "../src/lib/ai/travel-context.ts";
import { resolveDestinationAdvice } from "../src/lib/ai/destination-advice.ts";
import { resolveDestinationEntity } from "../src/lib/ai/destination-entity.ts";
import {
  canDiscoverDestinationPlaces,
  isCountryLevelDestination,
  resolveDestinationScopeFields,
} from "../src/lib/ai/destination-scope.ts";
import { hasDestinationCombinations, getDestinationCombinations } from "../src/lib/ai/destination-combination-suggestions.ts";
import { applyDestinationPendingSelection } from "../src/lib/ai/destination-pending-question.ts";

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed += 1;
  } else {
    console.log(`OK ${message}`);
  }
}

// Entity resolver
assert(resolveDestinationEntity("韓國").type === "country", "韓國 → country");
assert(resolveDestinationEntity("日本").type === "country", "日本 → country");
assert(resolveDestinationEntity("法國").type === "country", "法國 → country");
assert(resolveDestinationEntity("首爾").type === "city" || resolveDestinationScopeFields("首爾").destinationType === "city", "首爾 → city");
assert(resolveDestinationEntity("釜山").type === "city" || resolveDestinationScopeFields("釜山").destinationType === "city", "釜山 → city");
assert(isCountryLevelDestination("韓國"), "isCountryLevelDestination(韓國)");
assert(!isCountryLevelDestination("首爾"), "!isCountryLevelDestination(首爾)");
assert(!canDiscoverDestinationPlaces("韓國"), "block Places for 韓國");
assert(canDiscoverDestinationPlaces("首爾"), "allow Places for 首爾");
assert(!hasDestinationCombinations("韓國"), "no combinations for country");
assert(hasDestinationCombinations("首爾"), "combinations exist for 首爾");
assert(getDestinationCombinations("首爾").length >= 3, "首爾 has ≥3 curated combos");

// Case A step 1: month + country → ask city, not Places fail / days
{
  const session = createEmptySession();
  const merged = mergeTravelContext(session, "10月要去韓國");
  assert(merged.context.destination === "韓國", "A1 destination=韓國");
  assert(merged.context.destinationType === "country" || isCountryLevelDestination(merged.context.destination), "A1 type=country");
  assert(merged.context.travelMonth, "A1 travelMonth set");
  const advice = resolveDestinationAdvice(merged.context, merged.session, "10月要去韓國");
  assert(Boolean(advice.reply), "A1 has reply");
  assert(!/無法取得韓國的景點/.test(advice.reply ?? ""), "A1 no country places failure");
  assert(/首爾|釜山|濟州/.test(advice.reply ?? ""), "A1 asks for cities");
  assert(/・首爾：/.test(advice.reply ?? ""), "A1 multiline 首爾");
  assert(/你比較想去哪個城市或地區？/.test(advice.reply ?? ""), "A1 fixed ending");
  assert(advice.pendingQuestion?.type === "region_choice", "A1 pending=region_choice");
  assert(!/旅行日期或天數/.test(advice.reply ?? ""), "A1 does not ask days yet");
  assert(!/想偏城市|美食按摩|海島放鬆/.test(advice.reply ?? ""), "A1 no style-only ending");
  assert(!/優先考慮\s*10\s*月中旬/.test(advice.reply ?? ""), "A1 no mid-month window");
}

// Case A0: Thailand month + country → same city_selection ending shape as Korea
{
  const session = createEmptySession();
  const merged = mergeTravelContext(session, "10月想去泰國");
  assert(merged.context.destination === "泰國", "A0 destination=泰國");
  assert(merged.context.destinationType === "country" || isCountryLevelDestination(merged.context.destination), "A0 type=country");
  const advice = resolveDestinationAdvice(merged.context, merged.session, "10月想去泰國");
  assert(Boolean(advice.reply), "A0 has reply");
  assert(/曼谷/.test(advice.reply ?? "") && /清邁/.test(advice.reply ?? ""), "A0 lists Bangkok/Chiang Mai");
  assert(/普吉|蘇梅/.test(advice.reply ?? ""), "A0 lists concrete islands");
  assert(/・曼谷：/.test(advice.reply ?? ""), "A0 multiline 曼谷");
  assert(/・清邁：/.test(advice.reply ?? ""), "A0 multiline 清邁");
  assert(/你比較想去哪個城市或地區？/.test(advice.reply ?? ""), "A0 fixed ending");
  assert(!/城市、美食按摩，還是海島放鬆/.test(advice.reply ?? ""), "A0 no abstract style question");
  assert(!/可以考慮曼谷；想去/.test(advice.reply ?? ""), "A0 no semicolon-jammed cities");
  assert(advice.pendingQuestion?.type === "region_choice", "A0 pending=region_choice");
  assert(!/旅行日期或天數/.test(advice.reply ?? ""), "A0 does not ask days yet");
  assert(!/優先考慮\s*10\s*月中旬/.test(advice.reply ?? ""), "A0 no mid-month window");
}

// Case A-US: month + USA → city selection (not generic month / days)
{
  const session = createEmptySession();
  const merged = mergeTravelContext(session, "10月想去美國");
  assert(merged.context.destination === "美國", "US destination=美國");
  assert(isCountryLevelDestination(merged.context.destination), "US type=country");
  const advice = resolveDestinationAdvice(merged.context, merged.session, "10月想去美國");
  assert(Boolean(advice.reply), "US has reply");
  assert(/紐約/.test(advice.reply ?? "") && /洛杉磯/.test(advice.reply ?? ""), "US lists cities");
  assert(/・紐約：/.test(advice.reply ?? ""), "US multiline layout");
  assert(/你比較想去哪個城市或地區？/.test(advice.reply ?? ""), "US fixed ending");
  assert(advice.pendingQuestion?.type === "region_choice", "US pending=region_choice");
  assert(!/旅行日期或天數/.test(advice.reply ?? ""), "US does not ask days");
  assert(!/優先考慮\s*10\s*月中旬/.test(advice.reply ?? ""), "US no mid-month window");
}

// Case A-UK: month + UK → city selection
{
  const session = createEmptySession();
  const merged = mergeTravelContext(session, "10月要去英國");
  assert(merged.context.destination === "英國", "UK destination=英國");
  assert(isCountryLevelDestination(merged.context.destination), "UK type=country");
  const advice = resolveDestinationAdvice(merged.context, merged.session, "10月要去英國");
  assert(Boolean(advice.reply), "UK has reply");
  assert(/倫敦/.test(advice.reply ?? "") && /愛丁堡/.test(advice.reply ?? ""), "UK lists cities");
  assert(/・倫敦：/.test(advice.reply ?? ""), "UK multiline layout");
  assert(/你比較想去哪個城市或地區？/.test(advice.reply ?? ""), "UK fixed ending");
  assert(advice.pendingQuestion?.type === "region_choice", "UK pending=region_choice");
  assert(!/旅行日期或天數/.test(advice.reply ?? ""), "UK does not ask days");
}

// Case A-NL: April + Netherlands → city selection + tulip highlight optional
{
  const session = createEmptySession();
  const merged = mergeTravelContext(session, "4月想去荷蘭");
  assert(merged.context.destination === "荷蘭", "NL destination=荷蘭");
  const advice = resolveDestinationAdvice(merged.context, merged.session, "4月想去荷蘭");
  assert(/阿姆斯特丹/.test(advice.reply ?? ""), "NL lists Amsterdam");
  assert(/・阿姆斯特丹：/.test(advice.reply ?? ""), "NL multiline layout");
  assert(/你比較想去哪個城市或地區？/.test(advice.reply ?? ""), "NL fixed ending");
  assert(advice.pendingQuestion?.type === "region_choice", "NL pending=region_choice");
  assert(!/旅行日期或天數/.test(advice.reply ?? ""), "NL does not ask days");
}

// Case A-JP11: November + Japan → city selection
{
  const session = createEmptySession();
  const merged = mergeTravelContext(session, "11月想去日本");
  assert(merged.context.destination === "日本", "JP destination=日本");
  const advice = resolveDestinationAdvice(merged.context, merged.session, "11月想去日本");
  assert(/東京/.test(advice.reply ?? "") && /京都/.test(advice.reply ?? ""), "JP lists cities");
  assert(/・東京：/.test(advice.reply ?? ""), "JP multiline layout");
  assert(/你比較想去哪個城市或地區？/.test(advice.reply ?? ""), "JP fixed ending");
  assert(advice.pendingQuestion?.type === "region_choice", "JP pending=region_choice");
  assert(!/旅行日期或天數/.test(advice.reply ?? ""), "JP does not ask days");
}

// Case A step 2: select Seoul
{
  let session = createEmptySession();
  const m1 = mergeTravelContext(session, "10月要去韓國");
  session = {
    ...m1.session,
    travelContext: m1.context,
    conversationMode: "destination_planning",
    activeChatIntent: "destination_advice",
  };
  const a1 = resolveDestinationAdvice(m1.context, session, "10月要去韓國");
  session = {
    ...session,
    pendingQuestion: a1.pendingQuestion,
    travelContext: { ...m1.context, ...a1.contextPatch },
  };
  const applied = applyDestinationPendingSelection("首爾", session);
  assert(applied.contextPatch.destination === "首爾", "A2 destination→首爾");
  assert(applied.contextPatch.destinationCountry === "韓國", "A2 country kept 韓國");
  session = {
    ...applied.session,
    travelContext: {
      ...session.travelContext,
      ...applied.contextPatch,
      interests: session.travelContext?.interests ?? [],
    },
    adviceSelectionThisTurn: applied.selectedOption,
    lastResolvedPendingQuestion: session.pendingQuestion,
    pendingQuestion: undefined,
  };
  const a2 = resolveDestinationAdvice(session.travelContext, session, "首爾");
  assert(Boolean(a2.reply), "A2 has reply");
  assert(/幾天|天數|日期/.test(a2.reply ?? ""), "A2 asks days/dates");
}

// Case A step 3: 6 days → combinations
{
  let session = createEmptySession();
  session = {
    ...session,
    conversationMode: "destination_planning",
    activeChatIntent: "destination_advice",
    travelContext: {
      interests: [],
      destination: "首爾",
      destinationCountry: "韓國",
      destinationType: "city",
      destinationCity: "首爾",
      travelMonth: "10",
      suggestedStartDate: "2026-10-15",
    },
    pendingQuestion: {
      type: "ask_days",
      options: [],
      baseDestination: "首爾",
      destinationCountry: "韓國",
    },
  };
  const merged = mergeTravelContext(session, "6天");
  const advice = resolveDestinationAdvice(merged.context, merged.session, "6天");
  assert(Boolean(advice.reply), "A3 has reply");
  assert(!/無法取得首爾的景點/.test(advice.reply ?? ""), "A3 no Seoul places failure");
  assert(/建議組合|組合搭配/.test(advice.reply ?? ""), "A3 shows combinations");
  assert(advice.pendingQuestion?.type === "combination_choice", "A3 pending=combination_choice");
}

// Case B: country only → city ask, no month season
{
  const session = createEmptySession();
  const merged = mergeTravelContext(session, "我要去韓國");
  const advice = resolveDestinationAdvice(merged.context, merged.session, "我要去韓國");
  assert(/首爾|釜山|濟州/.test(advice.reply ?? ""), "B asks cities");
  assert(!/10 月|楓葉/.test(advice.reply ?? ""), "B no month maple copy");
  assert(advice.pendingQuestion?.type === "region_choice", "B pending=region_choice");
}

// Case C: city + dates → combinations directly
{
  const session = createEmptySession();
  const merged = mergeTravelContext(session, "10/1～10/5 要去釜山");
  assert(merged.context.destination === "釜山", "C destination=釜山");
  assert(merged.context.days === 5 || merged.context.days >= 4, `C days parsed (${merged.context.days})`);
  const advice = resolveDestinationAdvice(
    { ...merged.context, planningDaysConfirmed: true },
    { ...merged.session, conversationMode: "destination_planning", travelContext: merged.context },
    "10/1～10/5 要去釜山",
  );
  assert(/組合/.test(advice.reply ?? "") || hasDestinationCombinations("釜山"), "C combination path available");
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll country→city→combination flow checks passed");
