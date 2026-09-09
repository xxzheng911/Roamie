import assert from "node:assert/strict";
import fs from "node:fs";
import { withSubscriptionTimeout } from "../src/lib/subscription/async-timeout.ts";
import {
  consumePlusPurchaseContinuation,
  savePlusPurchaseContinuation,
} from "../src/lib/subscription/purchase-continuation.ts";

const sessionValues = new Map();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    sessionStorage: {
      getItem: (key) => sessionValues.get(key) ?? null,
      removeItem: (key) => sessionValues.delete(key),
      setItem: (key, value) => sessionValues.set(key, value),
    },
  },
});

const read = (path) => fs.readFileSync(path, "utf8");
const home = read("src/components/home/HomePersonalizationCard.tsx");
const profile = read("src/routes/_app.profile.tsx");
const quiz = read("src/components/PreferenceQuizCta.tsx");
const drafts = read("src/routes/_app.travel-drafts.tsx");
const purchaseProvider = read("src/providers/PlusPurchaseProvider.tsx");
const subscriptionProvider = read("src/providers/SubscriptionProvider.tsx");
const paywall = read("src/components/RoamiePlusIntroDialog.tsx");
const providers = read("src/providers/AppProviders.tsx");
const welcome = read("src/routes/welcome.tsx");
const settings = read("src/routes/_app.settings.tsx");
const management = read("src/lib/open-subscription-settings.ts");
const nativeManagement = read("src/lib/subscription/subscription-management-native.ts");
const appDelegate = read("ios/App/App/AppDelegate.swift");
const continuation = read("src/lib/subscription/purchase-continuation.ts");
const infoPlist = read("ios/App/App/Info.plist");
const geolocationPlugin = read(
  "node_modules/@capacitor/geolocation/ios/Sources/GeolocationPlugin/GeolocationPlugin.swift",
);

assert.match(home, /if \(!subscriptionHydrated\)/);
assert.match(home, /if \(hasPlusAccess\)/);
assert.match(home, /讓 Roamie 更懂你/);
assert.match(home, /記住你的旅行偏好，讓每次推薦更貼近你。/);
assert.match(home, /"長期旅行記憶"/);
assert.match(home, /"個人化推薦"/);
assert.match(home, /"無限 AI 對話"/);
assert.doesNotMatch(home, /收藏地點推薦|更深層 AI 對話|個人化行程規劃/);
assert.doesNotMatch(home, /稍後再說|立即升級 Plus/);
assert.match(home, /個人化旅遊中心/);
assert.match(home, /Roamie 正在記住你的旅行節奏/);
assert.match(home, /開始規劃我的旅程/);
assert.doesNotMatch(home, /返回 Free 模式|handleReturnFree|disablePlusTestMode/);
assert.match(
  home,
  /<\/div>\s*<\/div>\s*<div className="mt-4 flex w-full justify-center">[\s\S]*className="mx-auto w-full rounded-full bg-primary px-3 py-3 text-sm font-medium text-primary-foreground shadow-soft transition active:scale-\[0\.99\]"[\s\S]*開始規劃我的旅程/,
);
assert.match(
  home,
  /className="w-full rounded-full bg-primary px-3 py-3 text-sm font-medium[^\"]*"[\s\S]*升級 Plus/,
);
assert.match(subscriptionProvider, /SUBSCRIPTION_HYDRATION_TIMEOUT_MS/);
assert.match(subscriptionProvider, /fallback: "free"/);

for (const source of [home, profile, quiz, drafts]) {
  assert.match(source, /usePlusUpgrade/);
  assert.doesNotMatch(source, /<Plus(?:ComingSoon|Upgrade)Dialog/);
}
assert.match(profile, /openRevenueCatPaywall\(\)/);
assert.doesNotMatch(profile, /feature="quiz"/);
assert.match(profile, />\s*Plus 旅行偏好測驗\s*</);
assert.match(profile, />\s*讓 Roamie 更懂你的旅行偏好\s*</);
assert.match(profile, /完成幾個小問題，之後推薦地點與行程時會更貼近你。/);
assert.match(profile, /完成測驗並獲得更貼近你的行程及地點推薦/);
assert.match(profile, /升級 Plus 解鎖/);
assert.match(
  profile,
  /className="mt-4 w-full rounded-full bg-primary px-3 py-3 text-sm font-medium text-primary-foreground"/,
);
assert.match(quiz, /hasPlusAccess[\s\S]*travel-preference-test/);

assert.match(providers, /<PlusPurchaseProvider>/);
assert.match(providers, /pathname !== "\/welcome"/);
assert.equal((purchaseProvider.match(/<PlusComingSoonDialog/g) ?? []).length, 1);
assert.match(purchaseProvider, /openRevenueCatPaywall/);
assert.match(purchaseProvider, /paywallOpen/);
assert.match(purchaseProvider, /if \(!user\?\.id\)/);
assert.match(purchaseProvider, /savePlusPurchaseContinuation\("open_paywall"\)/);
assert.match(purchaseProvider, /navigate\(\{ to: "\/login" \}\)/);
assert.match(purchaseProvider, /consumePlusPurchaseContinuation\(\)/);
assert.match(purchaseProvider, /continuation === "open_paywall"/);
assert.match(purchaseProvider, /continuation === "restore_purchases"/);
assert.match(purchaseProvider, /pathname === "\/welcome"/);
assert.doesNotMatch(
  purchaseProvider,
  /configure\(|getOfferings\(|syncRevenueCatEntitlementWithServer/,
);
assert.match(continuation, /window\.sessionStorage/);
assert.match(continuation, /target\.removeItem\(STORAGE_KEY\)/);
assert.doesNotMatch(continuation, /localStorage/);
assert.doesNotMatch(`${purchaseProvider}\n${continuation}`, /["']\(guest\)["']/);

assert.equal(savePlusPurchaseContinuation("open_paywall", 1_000), true);
assert.equal(consumePlusPurchaseContinuation(1_001), "open_paywall");
assert.equal(
  consumePlusPurchaseContinuation(1_002),
  null,
  "authenticated remount cannot replay an already consumed paywall continuation",
);
assert.equal(savePlusPurchaseContinuation("restore_purchases", 2_000), true);
assert.equal(consumePlusPurchaseContinuation(2_001), "restore_purchases");
assert.equal(savePlusPurchaseContinuation("open_paywall", 3_000), true);
assert.equal(
  consumePlusPurchaseContinuation(3_000 + 31 * 60 * 1_000),
  null,
  "stale auth continuations expire instead of opening after an unrelated login",
);

assert.match(welcome, /usePlusUpgrade/);
assert.match(welcome, /openRevenueCatPaywall\(\)/);
assert.match(welcome, /await markIntroCompleted\(tier\)[\s\S]*openRevenueCatPaywall\(\)/);
assert.doesNotMatch(welcome, /openSubscriptionManagement|apps\.apple\.com\/account\/subscriptions/);
assert.match(home, /usePlusUpgrade/);
assert.match(profile, /usePlusUpgrade/);
assert.match(management, /apps\.apple\.com\/account\/subscriptions/);
assert.match(management, /Browser\.open\(\{ url \}\)/);
assert.doesNotMatch(management, /Plugins\?\.App\?\.openUrl|Capacitor App\.openUrl/);
assert.match(nativeManagement, /registerPlugin<SubscriptionManagementPlugin>/);
assert.match(nativeManagement, /SubscriptionManagement\.showManageSubscriptions\(\)/);
assert.match(nativeManagement, /catch \(error\)[\s\S]*return false/);
assert.match(appDelegate, /final class SubscriptionManagementPlugin: CAPPlugin, CAPBridgedPlugin/);
assert.match(appDelegate, /AppStore\.showManageSubscriptions\(in: activeScene\)/);
assert.match(appDelegate, /viewController\?\.view\.window\?\.windowScene/);
assert.match(appDelegate, /activationState == \.foregroundActive/);
assert.match(appDelegate, /registerPluginInstance\(SubscriptionManagementPlugin\(\)\)/);

assert.match(settings, /hasPlusAccess && plusEntitlementActiveSources\.includes\("app_store"\)/);
assert.match(settings, /取消訂閱/);
assert.match(settings, /確定要取消 Roamie Plus 嗎？/);
assert.match(settings, /取消後，Plus 功能仍可使用至目前訂閱期限結束。之後將自動回到 Free 方案。/);
assert.match(settings, /你的旅行偏好、收藏與既有資料不會被刪除，之後也可以隨時重新訂閱。/);
assert.match(settings, /繼續使用 Plus/);
assert.match(settings, /前往取消訂閱/);
assert.match(
  settings,
  /grid min-h-12 grid-cols-\[minmax\(0,1fr\)_5\.5rem\] items-center gap-3 px-6 py-3\.5[\s\S]*settings\.loginMethod[\s\S]*justify-self-end text-\[15px\] leading-5 text-muted-foreground/,
);
assert.match(settings, /mt-8 flex flex-col items-center gap-2\.5/);
assert.match(settings, /text-center text-sm leading-5 text-muted-foreground/);
assert.match(
  settings,
  /settings\.languageDeviceHint[\s\S]*grid min-h-12 w-full grid-cols-\[minmax\(0,1fr\)_5\.5rem\] items-center gap-3 px-6 py-3\.5 text-left/,
);
assert.equal(
  (settings.match(/grid-cols-\[minmax\(0,1fr\)_5\.5rem\]/g) ?? []).length,
  3,
  "Account, reminder, and language rows share one right-column contract",
);
assert.equal(
  (settings.match(/justify-self-end/g) ?? []).length,
  3,
  "Login provider, reminder toggle, and locale share one right edge",
);
assert.match(settings, /border-b border-border px-6 py-2\.5[\s\S]*settings\.account/);
assert.match(settings, /onClick=\{\(\) => void handleManageSubscription\(\)\}/);
assert.match(
  settings,
  /if \(await tryNativeSubscriptionManagement\(\)\) return;[\s\S]*await openSubscriptionManagement\(\)/,
);
assert.doesNotMatch(settings, /disablePlusTestMode|setSubscriptionState\("free"\)/);
assert.doesNotMatch(
  `${settings}\n${nativeManagement}\n${appDelegate}`,
  /setSubscriptionState\("free"\)|RevenueCat.*logOut/,
);
assert.doesNotMatch(settings, /settings\.notificationsOn|settings\.notificationsOff|notifLabel/);
assert.match(
  settings,
  /<p className="text-\[15px\] leading-5">\{t\("settings\.notificationsLabel"\)\}<\/p>[\s\S]*?<Switch/,
);

assert.match(paywall, /packages\.map/);
assert.match(paywall, /升級 Roamie Plus/);
assert.match(paywall, /讓 Roamie 記住你的旅行偏好，提供更貼近你的推薦與行程。/);
assert.doesNotMatch(paywall, /旅行性格測驗 — Plus/);
assert.doesNotMatch(paywall, /長期記住旅行偏好與收藏|更深度的個人化推薦|情境式對話與行程整理/);
assert.match(paywall, /pkg\.period === "yearly"/);
assert.match(paywall, /pkg\.period === "monthly"/);
assert.match(paywall, /重新載入方案/);
assert.match(paywall, /result\.status\.isActive/);
assert.match(paywall, /onOpenChange\(false\)/);
assert.doesNotMatch(paywall, /繼續使用免費版/);
assert.match(paywall, /aria-label="關閉"/);
assert.match(paywall, /<X className="h-4 w-4"/);

assert.equal(await withSubscriptionTimeout(Promise.resolve("ok"), 20, "timeout"), "ok");
await assert.rejects(
  withSubscriptionTimeout(new Promise(() => {}), 5, "offerings_timeout"),
  /offerings_timeout/,
);

assert.match(infoPlist, /<key>NSLocationWhenInUseUsageDescription<\/key>/);
assert.match(infoPlist, /<key>NSLocationAlwaysAndWhenInUseUsageDescription<\/key>/);
assert.doesNotMatch(infoPlist, /<key>UIBackgroundModes<\/key>/);
assert.match(geolocationPlugin, /requestLocationAuthorisation\(type: \.whenInUse\)/);
assert.doesNotMatch(geolocationPlugin, /requestLocationAuthorisation\(type: \.always\)/);

console.info("Plus purchase UI and hydration regression: PASS");
