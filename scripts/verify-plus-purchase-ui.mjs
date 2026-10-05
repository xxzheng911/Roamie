import { productionUiMessages } from "../src/lib/i18n/production-ui.ts";
import { uiCoverageMessages } from "../src/lib/i18n/ui-coverage.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build, stop } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
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

assert.match(home, /if \(variant === "skeleton"\)/);
assert.match(home, /if \(variant === "plus"\)/);
assert.match(home, /plusTitle/);
assert.match(home, /plusBody/);
assert.match(home, /"plusMemory"/);
assert.match(home, /"plusPersonal"/);
assert.match(home, /"plusUnlimited"/);
assert.doesNotMatch(home, /收藏地點推薦|更深層 AI 對話|個人化行程規劃/);
assert.doesNotMatch(home, /稍後再說|立即升級 Plus/);
assert.match(home, /plusCenter/);
assert.match(home, /plusLearning/);
assert.match(home, /plusStart/);
assert.doesNotMatch(home, /返回 Free 模式|handleReturnFree|disablePlusTestMode/);
assert.match(
  home,
  /<\/div>\s*<\/div>\s*<div className="mt-4 flex w-full justify-center">[\s\S]*className="mx-auto w-full rounded-full bg-primary px-3 py-3 text-sm font-medium text-primary-foreground shadow-soft transition active:scale-\[0\.99\]"[\s\S]*plusStart/,
);
assert.match(
  home,
  /className="w-full rounded-full bg-primary px-3 py-3 text-sm font-medium[^\"]*"[\s\S]*uiCoverage\.plusUpgrade/,
);
assert.match(subscriptionProvider, /SUBSCRIPTION_HYDRATION_TIMEOUT_MS/);
assert.match(subscriptionProvider, /fallback: "free"/);

for (const source of [home, profile, quiz, drafts]) {
  assert.match(source, /usePlusUpgrade/);
  assert.doesNotMatch(source, /<Plus(?:ComingSoon|Upgrade)Dialog/);
}
assert.match(profile, /openRevenueCatPaywall\(\)/);
assert.doesNotMatch(profile, /feature="quiz"/);
assert.match(profile, /plusPurchase\.profileLabel/);
assert.match(profile, /plusPurchase\.profileHeading/);
assert.match(profile, /plusPurchase\.profileActiveBody/);
assert.match(profile, /plusPurchase\.profileBody/);
assert.match(profile, /plusPurchase\.unlock/);
assert.match(
  profile,
  /className="mt-4 w-full rounded-full bg-primary px-3 py-3 text-sm font-medium text-primary-foreground"/,
);
assert.match(quiz, /hasPlusAccess[\s\S]*travel-preference-test/);

assert.match(providers, /<PlusPurchaseProvider>/);
assert.doesNotMatch(providers, /ProviderGate|shouldUseLightStartupShell/);
assert.equal((purchaseProvider.match(/<PlusComingSoonDialog/g) ?? []).length, 1);
assert.match(purchaseProvider, /openRevenueCatPaywall/);
assert.match(purchaseProvider, /paywallOpen/);
assert.match(purchaseProvider, /if \(!user\?\.id\)/);
assert.match(purchaseProvider, /if \(!user\?\.id\)\s*\{\s*setPaywallOpen\(false\);\s*requireAuthForAction\("subscription_action"\);\s*return "auth_required";/);
assert.doesNotMatch(purchaseProvider, /savePlusPurchaseContinuation|navigate\(|stashPendingAuthAction/);
assert.match(purchaseProvider, /usePendingAuthActionResume\("subscription_action", \(\) => \{\s*openAuthenticatedPaywall\(\);/);
const runtime = read("src/components/auth/AuthActionRuntime.tsx");
const dialog = read("src/components/auth/AuthRequirementDialog.tsx");
const resume = read("src/hooks/use-pending-auth-action.ts");
assert.match(providers, /<AuthActionRuntime/);
assert.match(runtime, /registerAuthRequirementPrompt\(\(request\) => \{\s*setPrompt\(request\);/);
assert.match(runtime, /if \(loading \|\| !user\) return/);
assert.match(runtime, /resolvePendingAuthReturnPath\(\s*pending.sourcePath, isOnboardingCompletedSync\(\), true/);
assert.match(runtime, /returnPathsMatch\(href, destination\)/);
assert.match(runtime, /claimPendingAuthAction\(pending.id\)/);
assert.match(runtime, /dispatchEvent\(new CustomEvent<PendingAuthAction>\(AUTH_ACTION_RESUME_EVENT/);
assert.match(runtime, /onOpenChange=\{\(open\) => \{[\s\S]*?setPrompt\(null\);\s*\}\}/);
assert.match(runtime, /onLogin=\{\(\) => \{[\s\S]*?commitAuthRequirementLogin\(current\);/);
assert.doesNotMatch(runtime, /RevenueCat|purchase\(|subscription_action/);
assert.match(dialog, /<AlertDialogCancel[^>]*>\{t\("authGate.back"\)\}<\/AlertDialogCancel>/);
assert.match(dialog, /event.preventDefault\(\);\s*onLogin\(\);/);
assert.match(resume, /AUTH_ACTION_RESUME_EVENT/);
assert.match(resume, /pending.action !== action/);
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

assert.match(welcome, /stashOnboardingPlanIntent\(tier\)/);
assert.match(welcome, /await markOnboardingCompleted\(\)/);
assert.match(welcome, /navigate\(\{ to: "\/login", replace: true \}\)/);
assert.doesNotMatch(welcome, /applyLocalMockPlanTier|syncMockPlanTierToProfile|disablePlusTestMode|openRevenueCatPaywall/);
assert.doesNotMatch(welcome, /openSubscriptionManagement|apps\.apple\.com\/account\/subscriptions/);
assert.match(home, /usePlusUpgrade/);
assert.match(profile, /usePlusUpgrade/);
assert.match(management, /apps\.apple\.com\/account\/subscriptions/);
assert.match(management, /openExternalUrl/);
assert.doesNotMatch(management, /Browser\.open/);
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
for (const copy of [
  "取消訂閱", "確定要取消 Roamie Plus 嗎？",
  "取消後，Plus 功能仍可使用至目前訂閱期限結束。之後將自動回到 Free 方案。",
  "你的旅行偏好、收藏與既有資料不會被刪除，之後也可以隨時重新訂閱。",
  "繼續使用 Plus", "前往取消訂閱",
]) {
  const key = Object.keys(productionUiMessages["zh-TW"]).find(key => productionUiMessages["zh-TW"][key] === copy);
  assert.ok(key, `Missing subscription disclosure: ${copy}`);
  assert.ok(settings.includes(`productionUi.${key}`), `Settings must render ${key}`);
  for (const locale of ["en", "ja", "ko"]) assert.ok(productionUiMessages[locale][key]);
}
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
assert.match(paywall, /plusPurchase\.heading/);
assert.match(paywall, /plusPurchase\.description/);
assert.doesNotMatch(paywall, /旅行性格測驗 — Plus/);
assert.doesNotMatch(paywall, /長期記住旅行偏好與收藏|更深度的個人化推薦|情境式對話與行程整理/);
assert.match(paywall, /pkg\.period === "yearly"/);
assert.match(paywall, /pkg\.period === "monthly"/);
assert.match(paywall, /plusPurchase\.retry/);
assert.match(paywall, /result\.status\.isActive/);
assert.match(paywall, /onOpenChange\(false\)/);
assert.doesNotMatch(paywall, /繼續使用免費版/);
assert.match(paywall, /aria-label=\{t\("plusPurchase\.close"\)\}/);
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



assert.equal(uiCoverageMessages["zh-TW"].plusTitle, "讓 Roamie 更懂你");
assert.equal(uiCoverageMessages["zh-TW"].plusBody, "記住你的旅行偏好，讓每次推薦更貼近你。");

// Execute the real provider CTA and canonical gate/pending authority. React hooks
// are a small synchronous harness; external billing boundaries throw if reached.
const fixtureDir = fs.mkdtempSync(join(tmpdir(), "plus-gate-"));
const oldSessionStorage = globalThis.sessionStorage;
try {
  globalThis.sessionStorage = window.sessionStorage;
  window.location = { pathname: "/profile", search: "?tab=plus", assign: () => assert.fail("unexpected direct login") };
  globalThis.plusGateFixture = { user: null, states: [], cursor: 0, bypass: false, resume: null, effects: [], navigations: [] };
  const mocks = {
    "react": `const f=()=>globalThis.plusGateFixture;
      export const createContext=()=>({Provider:"context"});
      export const useContext=()=>null;
      export const useCallback=x=>x;
      export const useMemo=x=>x();
      export const useRef=x=>({current:x});
      export const useEffect=effect=>{f().effects.push(effect)};
      export const useState=x=>{const slots=f().states;const i=f().cursor++;if(!(i in slots))slots[i]=x;return[slots[i],v=>{slots[i]=v}];};`,
    "react/jsx-runtime": `export const jsx=(type,props)=>({type,props});export const jsxs=jsx;`,
    "@tanstack/react-router": `export const useRouterState=({select})=>select({status:"idle",location:{pathname:"/profile",searchStr:"?tab=plus"}});export const useNavigate=()=>options=>globalThis.plusGateFixture.navigations.push(options.to);`,
    "@/hooks/use-add-to-trip": `export const useAddToTrip=()=>({openAddToTrip:()=>{throw Error("unexpected trip write")}});`,
    "@/lib/places-storage": `export const toggleSavePlace=()=>{throw Error("unexpected saved place write")};`,
    "@/components/auth/AuthRequirementDialog": `export const AuthRequirementDialog="auth-dialog";`,
    "@/lib/onboarding-storage": `export const isOnboardingCompletedSync=()=>true;`,
    "@/hooks/use-auth": `export const useAuth=()=>({user:globalThis.plusGateFixture.user,loading:false});`,
    "@/lib/auth-session": `export const readCachedAuthenticatedUserIdSync=()=>globalThis.plusGateFixture.user?.id??null;`,
    "@/hooks/use-i18n": `export const useI18n=()=>({t:x=>x});`,
    "@/hooks/use-access": `export const useAccess=()=>({enablePlusTestMode:()=>{throw Error("unexpected test upgrade")}});`,
    "@/hooks/use-subscription-operation": `export const useSubscriptionOperation=()=>()=>{throw Error("unexpected billing operation")};`,
    "@/providers/SubscriptionProvider": `export const useSubscription=()=>({restore:()=>{throw Error("unexpected restore")},purchase:()=>{throw Error("unexpected purchase")}});`,
    "@/lib/access/subscription-dev-mode": `export const canBypassSubscriptionBilling=()=>globalThis.plusGateFixture.bypass;`,
    "@/hooks/use-pending-auth-action": `export const usePendingAuthActionResume=(action,handler)=>{globalThis.plusGateFixture.resume={action,handler}};`,
    "@/components/PlusComingSoonDialog": `export const PlusComingSoonDialog="paywall";`,
    "sonner": `export const toast={success:()=>{throw Error("unexpected upgrade toast")}};`,
  };
  const file = join(fixtureDir, "fixture.cjs");
  await build({
    stdin: { contents: `export {PlusPurchaseProvider} from './src/providers/PlusPurchaseProvider';export {AuthActionRuntime} from './src/components/auth/AuthActionRuntime';export * from './src/lib/auth-action';export * from './src/lib/auth-pending-action';`, resolveDir: process.cwd() },
    bundle: true, platform: "node", format: "cjs", outfile: file,
    plugins: [{ name: "external-boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js" }));
    } }],
  });
  const api = createRequire(import.meta.url)(file);
  const fixture = globalThis.plusGateFixture;
  const providerStates = [];
  const runtimeStates = [];
  const render = () => {
    fixture.states = providerStates; fixture.cursor = 0; fixture.effects = [];
    return api.PlusPurchaseProvider({ children: null });
  };
  const renderRuntime = () => {
    fixture.states = runtimeStates; fixture.cursor = 0; fixture.effects = [];
    return api.AuthActionRuntime();
  };
  const paywallOpen = tree => tree.props.children.find(child => child?.type === "paywall").props.open;
  renderRuntime();
  fixture.effects[0](); // Mount the actual runtime's prompt and navigation registration.
  const navigations = fixture.navigations;
  for (const bypass of [false, true]) {
    fixture.bypass = bypass;
    assert.equal(render().props.value.openRevenueCatPaywall(), "auth_required");
    let prompt = renderRuntime();
    assert.equal(prompt.type, "auth-dialog");
    assert.equal(prompt.props.open, true);
    assert.equal(paywallOpen(render()), false);
    assert.equal(api.peekPendingAuthAction(), null, "CTA does not stash before explicit login");
    assert.deepEqual(navigations, [], "Guest CTA does not directly navigate to login");
    prompt = renderRuntime();
    prompt.props.onOpenChange(false); // Actual cancel callback from AuthActionRuntime.
    assert.equal(renderRuntime().props.open, false);
    assert.equal(api.peekPendingAuthAction(), null);
    assert.equal(paywallOpen(render()), false);
    assert.deepEqual(navigations, []);
    assert.equal(window.location.pathname + window.location.search, "/profile?tab=plus");
  }
  fixture.bypass = false;
  render().props.value.openRevenueCatPaywall();
  renderRuntime().props.onLogin(); // Actual login callback stashes through canonical authority.
  const pending = api.peekPendingAuthAction();
  assert.equal(pending.action, "subscription_action");
  assert.equal(pending.sourcePath, "/profile?tab=plus");
  assert.deepEqual(navigations, ["/login"]);
  assert.equal(consumePlusPurchaseContinuation(), null, "new Guest flow creates no second legacy continuation");
  assert.equal(paywallOpen(render()), false, "choosing login cannot start Guest purchase");
  fixture.user = { id: "verified-user", email: "fixture@example.test" };
  render();
  assert.equal(fixture.resume.action, "subscription_action");
  assert.equal(api.returnPathsMatch("/profile?tab=plus", pending.sourcePath), true);
  assert.equal(api.returnPathsMatch("/map", pending.sourcePath), false);
  const claimed = api.claimPendingAuthAction(pending.id);
  assert.equal(claimed.action, fixture.resume.action);
  fixture.resume.handler();
  assert.equal(paywallOpen(render()), true, "canonical resume opens existing authenticated paywall");
  assert.equal(api.claimPendingAuthAction(pending.id), null, "continuation cannot replay");
  assert.equal(render().props.value.openRevenueCatPaywall(), "coming_soon");
  assert.equal(paywallOpen(render()), true);
  assert.equal(renderRuntime().props.open, false, "authenticated CTA keeps existing flow");
  assert.deepEqual(navigations, ["/login"]);
} finally {
  globalThis.sessionStorage = oldSessionStorage;
  delete globalThis.plusGateFixture;
  stop();
  fs.rmSync(fixtureDir, { recursive: true, force: true });
}
console.info("Plus purchase UI, Auth Action Gate, canonical continuation and hydration regression: PASS");
