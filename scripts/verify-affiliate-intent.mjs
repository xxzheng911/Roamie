#!/usr/bin/env node
/**
 * 聯盟導購 CTA intent 回歸驗證（不依賴 vite-node，避免掃描路由檔）。
 * 執行：npm run verify:affiliate
 */
import assert from "node:assert/strict";
import {
  resolveAffiliatePlaceIntent,
  affiliateIntentLabel,
  affiliateIntentFromPlaceInput,
} from "../src/services/affiliate/affiliate-place-intent.ts";

const cases = [
  [{ typeLabel: "景點", placeName: "釜山塔" }, "tickets", "查看門票"],
  [{ typeLabel: "博物館", placeName: "國立博物館" }, "tickets", "查看門票"],
  [{ typeLabel: "美術館" }, "tickets", "查看門票"],
  [{ placeName: "東京迪士尼樂園" }, "tickets", "查看門票"],
  [{ placeName: "台北 101 展望台" }, "tickets", "查看門票"],
  [{ primaryType: "tourist_attraction", placeName: "清水寺" }, "tickets", "查看門票"],
  [{ types: ["museum"], placeName: "故宮" }, "tickets", "查看門票"],
  [{ typeLabel: "一日遊", placeName: "九份" }, "experiences", "查看相關體驗"],
  [{ placeName: "京都和服體驗" }, "experiences", "查看相關體驗"],
  [{ typeLabel: "咖啡廳", placeName: "藍瓶咖啡" }, "experiences", "查看相關體驗"],
  [{ placeName: "沖繩浮潛體驗" }, "experiences", "查看相關體驗"],
  [{ typeLabel: "飯店", placeName: "W 飯店" }, "accommodation", "查看住宿方案"],
  [{ placeName: "台北君悅酒店" }, "accommodation", "查看住宿方案"],
  [{ types: ["lodging"], placeName: "承攜行旅" }, "accommodation", "查看住宿方案"],
  [{ primaryType: "hotel", placeName: "Agoda Test Inn" }, "accommodation", "查看住宿方案"],
];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.info("[verify:affiliate] Affiliate place intent 驗證\n");

for (const [input, expectedIntent, expectedLabel] of cases) {
  const label = `${JSON.stringify(input)} → ${expectedIntent}`;
  test(label, () => {
    const intent = resolveAffiliatePlaceIntent(input);
    assert.equal(intent, expectedIntent);
    assert.equal(affiliateIntentLabel(intent), expectedLabel);
    const wrapped = affiliateIntentFromPlaceInput(input);
    assert.equal(wrapped.intent, expectedIntent);
    assert.equal(wrapped.label, expectedLabel);
  });
}

test("住宿優先於景點關鍵字（飯店旁的展望台）", () => {
  const intent = resolveAffiliatePlaceIntent({
    placeName: "飯店展望台景觀房",
    typeLabel: "住宿",
  });
  assert.equal(intent, "accommodation");
});

console.info(`\n[verify:affiliate] OK — ${cases.length + 1} cases`);
