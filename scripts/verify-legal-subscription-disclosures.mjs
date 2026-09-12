import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const legal = read("src/content/legal.ts");
const paywall = read("src/components/RoamiePlusIntroDialog.tsx");
const affiliate = read("src/components/trip/TripAffiliateSection.tsx");

for (const phrase of [
  "訂閱會自動續訂",
  "隱私權政策",
  "服務條款／EULA",
  "價格與週期以 Apple 顯示為準",
])
  assert.match(paywall, new RegExp(phrase));
assert.match(paywall, /purchase\(packageId\)/);
assert.match(paywall, /restore\(\)/);
assert.match(paywall, /LegalDocumentSheet/);
for (const phrase of [
  "Supabase",
  "OpenAI",
  "Google Maps／Places",
  "RevenueCat",
  "Cloudflare",
  "永久刪除帳號",
  "不會自動取消 Apple App Store 訂閱",
  "去識別",
  "合作佣金",
])
  assert.match(legal, new RegExp(phrase));
assert.match(affiliate, /Roamie可能獲得合作佣金，不影響你的價格/);
assert.doesNotMatch(`${legal}\n${paywall}\n${affiliate}`, /contect@roamie\.tw/i);

console.log("Legal and subscription disclosures: PASS");
