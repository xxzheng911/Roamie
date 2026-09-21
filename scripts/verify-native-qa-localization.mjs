import { mapPlaceResultsToChatItems } from "../src/lib/chat-session.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import { nativeQaMessages } from "../src/lib/i18n/native-qa.ts";
import { translate } from "../src/lib/i18n/translate.ts";
import { CHAT_SHORTCUT_SEND_CHIPS, chatShortcutContract } from "../src/lib/chat-shortcut-chips.ts";
import { detectChatIntent, resolveNormalizedShortcutRequestFromText } from "../src/lib/ai/chat-intent.ts";
import { buildSummaryForRecommendations } from "../src/lib/ai/chat-place-recommendation.ts";
import { affiliateDisplayLabel, itineraryTransportDisplay, placeCategoryDisplay, openingCopyDisplay } from "../src/lib/native-qa-display.ts";
import { placeOpeningStatusLabel } from "../src/lib/normalized-opening-status.ts";
const locales = ["zh-TW", "en", "ja", "ko"];
const expected = {"zh-TW":"今天想放鬆走走", en:"I'd like a relaxing walk today", ja:"今日はのんびり散歩したい", ko:"오늘은 여유롭게 걷고 싶어요"};
const place = Object.freeze({ id: "test", name: "高雄咖啡店", address: "大阪一丁目", primaryType: "cafe", types: ["cafe"], displayCategory: "咖啡廳", normalizedOpeningLabel: "營業中", normalizedOpeningStatus: "open", openStatus: "open", openStatusLabel: "營業中", openNow: true });
for (const locale of locales) {
  assert.deepEqual(Object.keys(nativeQaMessages[locale]), Object.keys(nativeQaMessages["zh-TW"]));
  for (const key of Object.keys(nativeQaMessages[locale])) {
    assert.equal(translate(locale, `nativeQa.${key}`), nativeQaMessages[locale][key]);
    assert.deepEqual([...nativeQaMessages[locale][key].matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(), [...nativeQaMessages["zh-TW"][key].matchAll(/\{\w+\}/g)].map(m=>m[0]).sort());
  }
  const recommendation = mapPlaceResultsToChatItems([{place: {...place, name: "Official Café", address: "Tokyo", lat:35, lng:139, rating:4.5, userRatingCount:200}, ctx:{locale, categoryIntent:"cafe"}}])[0];
  assert.ok(recommendation.reason?.trim());
  if(locale === "en" || locale === "ko") assert.doesNotMatch(recommendation.reason, /\p{Script=Han}/u);
  const first = chatShortcutContract(CHAT_SHORTCUT_SEND_CHIPS[0], locale);
  assert.equal(first.displayMessage, expected[locale]);
  assert.equal(first.canonicalIntent, "relax_walk");
  for (const payload of CHAT_SHORTCUT_SEND_CHIPS) {
    const contract = chatShortcutContract(payload, locale);
    assert.equal(contract.routingPayload, payload);
    assert.equal(detectChatIntent(contract.routingPayload), detectChatIntent(payload));
    assert.deepEqual(resolveNormalizedShortcutRequestFromText(contract.routingPayload), resolveNormalizedShortcutRequestFromText(payload));
    const restored = JSON.parse(JSON.stringify({ role:"user", content:contract.displayMessage }));
    assert.equal(restored.content, contract.displayMessage);
    const summary = buildSummaryForRecommendations(detectChatIntent(payload), [{name:"Official Café"}], {interests:[]}, [], null, null, locale);
    assert.ok(summary.includes("Official Café"));
    if(locale!=="zh-TW") {assert.notEqual(contract.displayMessage,payload);assert.ok(!summary.includes("附近找到"));}
  }
  for (const kind of ["hotel", "flight", "package", "ticket"]) assert.ok(!translate(locale, `nativeQa.${kind}`).startsWith("nativeQa."));
  for(const provider of ["klook","kkday"]) {
    const brand=provider==="klook"?"Klook":"KKday";
    for(const key of ["ticketSearch","experienceSearch","transportSearch"]) {
      const label=affiliateDisplayLabel({provider,kind:"activity_ticket",label:translate("zh-TW",`nativeQa.${key}`,{brand})},locale);
      assert.equal(label,translate(locale,`nativeQa.${key}`,{brand}));
    }
    assert.equal(affiliateDisplayLabel({provider,kind:"activity_ticket",label:brand},locale),brand);
  }
  for(const provider of ["trip","agoda","booking"]) for(const kind of ["hotel","flight","package"]) {
    const label=affiliateDisplayLabel({provider,kind,label:"legacy"},locale);assert.ok(!label.includes("nativeQa."));
    if(locale==="en") assert.doesNotMatch(label,/\p{Script=Han}/u);
  }
  for(const mode of ["walk","transit","drive","taxi","bike","scooter"]) assert.equal(itineraryTransportDisplay(translate("zh-TW",`nativeQa.${mode}`),locale),translate(locale,`nativeQa.${mode}`));
  assert.equal(placeCategoryDisplay(place,locale),translate(locale,"nativeQa.category_cafe"));
  assert.equal(placeCategoryDisplay({...place,primaryType:"restaurant",types:["restaurant"],name:"Restaurant"},locale),translate(locale,"nativeQa.category_restaurant"));
  for(const status of ["open","closed","unknown"]) assert.equal(placeOpeningStatusLabel({...place,normalizedOpeningStatus:status},locale),translate(locale,`place.${status==="unknown"?"hoursUnknown":status}`));
  assert.equal(placeOpeningStatusLabel({...place,normalizedOpeningStatus:undefined,openNow:undefined,openStatus:undefined},locale),translate(locale,"place.open"));
  assert.equal(placeOpeningStatusLabel({...place,openStatus:"closing_soon"},locale),translate(locale,"nativeQa.closingSoon"));
  assert.equal(openingCopyDisplay("明天 09:00 開始營業",locale),translate(locale,"nativeQa.opensTomorrow",{time:"09:00"}));
  assert.equal(place.name,"高雄咖啡店");assert.equal(place.address,"大阪一丁目");
  console.log(`PASS ${locale}: shortcut/routing/assistant, commerce/transit, cached category/status projection`);
}
const route=fs.readFileSync("src/routes/_app.chat.tsx","utf8");const send=route.slice(route.indexOf("  const send = async ("),route.indexOf("\n  };",route.indexOf("  const send = async (")));
assert.doesNotMatch(send,/content: trimmed/);assert.match(send,/content: displayMessage/);assert.match(route,/chatInput: lastUser\?\.content/);
assert.match(route,/resolveHomeShortcutSearchProfile\(sessionForSave\),\s+locale,/);
const card=fs.readFileSync("src/components/map/MapExplorePlaceCards.tsx","utf8");assert.match(card,/placeCategoryDisplay\(p, locale\)/);assert.match(card,/placeOpeningStatusLabel\(p, locale\)/);
console.log("PASS native screenshot regressions and production call-site wiring");

const englishSurface = [chatShortcutContract(CHAT_SHORTCUT_SEND_CHIPS[0], "en").displayMessage, ...Object.values(nativeQaMessages.en), placeOpeningStatusLabel(place,"en"), buildSummaryForRecommendations("attraction",[{name:"Official Place"}],{interests:[]},[],null,null,"en")].join("\n");
for(const forbidden of ["今天想放鬆走走","附近找到","查看票券優惠","在 Klook 搜尋票券","在 KKday 搜尋票券","大眾運輸","查看大眾運輸路線","機票推薦","住宿推薦","美食","咖啡廳","營業中"]) assert.ok(!englishSurface.includes(forbidden), forbidden);
console.log("PASS all English screenshot counterexamples (Roamie UI only)");
