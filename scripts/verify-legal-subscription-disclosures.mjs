import { plusPurchaseMessages } from "../src/lib/i18n/plus-purchase.ts";
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
  assert.match(
    plusPurchaseMessages["zh-TW"].disclosure +
      plusPurchaseMessages["zh-TW"].privacy +
      plusPurchaseMessages["zh-TW"].terms,
    new RegExp(phrase),
  );
for (const key of ["disclosure", "privacy", "terms", "restore"]) {
  assert.match(paywall, new RegExp(`plusPurchase\\.${key}`));
  for (const messages of Object.values(plusPurchaseMessages)) assert.ok(messages[key].trim());
}
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
assert.match(legal, /Roamie可能獲得合作佣金，不影響你的價格/);
assert.match(affiliate, /hidesInlineAffiliateDisclosure/);
assert.doesNotMatch(`${legal}\n${paywall}\n${affiliate}`, /contect@roamie\.tw/i);

console.log("Legal and subscription disclosures: PASS");
