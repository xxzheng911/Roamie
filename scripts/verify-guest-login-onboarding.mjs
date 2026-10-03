import assert from "node:assert/strict";
import { build, stop } from "esbuild";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

// Real onboarding storage, navigation, Welcome rendering, gate, resume hook and
// Plus provider; only external storage/platform/UI/billing boundaries are fixtures.
const dir = mkdtempSync(join(tmpdir(), "guest-login-onboarding-"));
const require = createRequire(import.meta.url);
const originals = Object.fromEntries(["window", "localStorage", "sessionStorage", "guestLoginFixture"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  const mocks = {
    "react": `const f=()=>globalThis.guestLoginFixture;
      export const createContext=()=>({Provider:"context"});
      export const useContext=()=>null;
      export const useCallback=x=>x;
      export const useMemo=x=>x();
      export const useRef=x=>{const slots=f().states;const i=f().cursor++;return slots[i]??(slots[i]={current:x})};
      export const useEffect=effect=>{f().effects.push(effect)};
      export const useState=x=>{const slots=f().states;const i=f().cursor++;if(!(i in slots))slots[i]=typeof x==="function"?x():x;return[slots[i],v=>{slots[i]=typeof v==="function"?v(slots[i]):v}];};`,
    "react/jsx-runtime": `export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";`,
    "@tanstack/react-router": `export const useRouterState=({select})=>select({status:"idle",location:{pathname:window.location.pathname,searchStr:window.location.search}});export const useNavigate=()=>options=>globalThis.guestLoginFixture.navigate(options);export const createFileRoute=()=>config=>config;`,
    "@/hooks/use-add-to-trip": `export const useAddToTrip=()=>({openAddToTrip:()=>{globalThis.guestLoginFixture.tripWrites++}});`,
    "@/lib/places-storage": `export const toggleSavePlace=()=>{globalThis.guestLoginFixture.favoriteWrites++};`,
    "@/components/auth/AuthRequirementDialog": `export const AuthRequirementDialog="auth-dialog";`,
    "@/hooks/use-auth": `export const useAuth=()=>({user:globalThis.guestLoginFixture.user,loading:globalThis.guestLoginFixture.loading});`,
    "@/lib/auth-session": `export const getClientAuthSession=async()=>globalThis.guestLoginFixture.user?{user:globalThis.guestLoginFixture.user}:null;export const readCachedAuthenticatedUserIdSync=()=>globalThis.guestLoginFixture.user?.id??null;`,
    "@/hooks/use-i18n": `export const useI18n=()=>({t:x=>x,tList:()=>[]});`,
    "@/hooks/use-access": `export const useAccessOptional=()=>null;export const useAccess=()=>({enablePlusTestMode:()=>{throw Error("unexpected test upgrade")}});`,
    "@/hooks/use-subscription-operation": `export const useSubscriptionOperation=()=>()=>{throw Error("unexpected billing operation")};`,
    "@/providers/SubscriptionProvider": `export const useSubscription=()=>({restore:()=>{throw Error("unexpected restore")},purchase:()=>{throw Error("unexpected purchase")}});`,
    "@/lib/access/subscription-dev-mode": `export const canBypassSubscriptionBilling=()=>globalThis.guestLoginFixture.bypass;`,
    "@/components/PlusComingSoonDialog": `export const PlusComingSoonDialog="paywall";`,
    "sonner": `export const toast={success:()=>{throw Error("unexpected upgrade toast")}};`,
    "@capacitor/preferences": `export const Preferences={get:async({key})=>({value:globalThis.guestLoginFixture.preferences.get(key)??null}),set:async({key,value})=>{globalThis.guestLoginFixture.preferences.set(key,value)},remove:async({key})=>{globalThis.guestLoginFixture.preferences.delete(key)}};`,
    "@/lib/capacitor-bridge-ready": `export const waitForCapacitorBridge=async()=>true;`,
    "@/services/platform": `export const detectPlatform=()=>({isCapacitor:globalThis.guestLoginFixture.native,isIOS:false});`,
    "@/lib/supabase-auth-storage": `export const warmSupabaseAuthStorage=async()=>{};export const readHydratedAuthSessionRaw=()=>null;`,
    "@/lib/preferences-storage": `export const isPreferenceQuizCompleted=async()=>false;`,
    "@/lib/admin/admin-route-boundary": `export const consumeAdminReturn=()=>null;`,
    "@/lib/startup-route": `export const hasLikelyPersistedSession=()=>!!globalThis.guestLoginFixture.user;`,
    "@/components/StartupGate": `export const markSessionBootstrapped=()=>{};`,
    "@/lib/ios-snapshot-bridge": `export const scheduleIosSnapshotRefreshBurst=()=>{};`,
    "@/lib/plan-tier": `export {markOnboardingCompleted as markIntroCompleted} from "@/lib/onboarding-storage";`,
    "@/lib/plan-tier/sync-mock-tier": `export const applyLocalMockPlanTier=()=>{};export const syncMockPlanTierToProfile=async()=>{};`,
    "@/hooks/use-plus-upgrade": `export const usePlusUpgrade=()=>({openRevenueCatPaywall:()=>globalThis.guestLoginFixture.openPlus()});`,
    "@/hooks/use-ios-interactive-route": `export const useIosInteractiveRoute=()=>{};`,
    "@/components/MobileFrame": `export const MobileFrame="frame";`,
    "lucide-react": `export const ArrowRight="arrow",Crown="crown",Loader2="loader",Sparkles="sparkles";`,
    "@/services/analytics": `export const trackEvent=()=>{};`,
  };

  const file = join(dir, "fixture.cjs");
  await build({
    stdin: { contents: `export {Route as WelcomeRoute} from './src/routes/welcome';
      export {AuthActionRuntime} from './src/components/auth/AuthActionRuntime';
      export {PlusPurchaseProvider} from './src/providers/PlusPurchaseProvider';
      export {usePendingAuthActionResume} from './src/hooks/use-pending-auth-action';
      export * from './src/lib/onboarding-storage';export * from './src/lib/auth-action';
      export * from './src/lib/auth-pending-action';export * from './src/lib/login-navigation';
      export * from './src/lib/post-auth-navigation';export * from './src/lib/auth-restore';`, resolveDir: process.cwd() },
    bundle: true, platform: "node", format: "cjs", outfile: file,
    define: { "import.meta.env": JSON.stringify({ DEV: false, SSR: false }) },
    plugins: [{ name: "boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js", resolveDir: process.cwd() }));
    } }],
  });
  const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
  function setup(native, local = new Map(), preferences = new Map()) {
    const f = { native, preferences, user: null, loading: false, states: [], cursor: 0, effects: [], navigations: [], timers: new Map(), timerId: 0, favoriteWrites: 0, tripWrites: 0 };
    globalThis.guestLoginFixture = f;
    globalThis.localStorage = storage(local);
    globalThis.sessionStorage = storage(new Map());
    const events = new EventTarget();
    globalThis.window = { localStorage, sessionStorage, location: new URL("https://fixture.example/welcome"),
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
      setTimeout: fn => { const id = ++f.timerId; f.timers.set(id, fn); return id; }, clearTimeout: id => f.timers.delete(id) };
    f.navigate = opts => {
      f.navigations.push(opts);
      const url = new URL(opts.to, "https://fixture.example");
      if (opts.search) url.search = new URLSearchParams(opts.search).toString();
      window.location = url;
      window.location.assign = path => f.navigate({ to: path });
      window.location.replace = path => f.navigate({ to: path });
    };
    f.navigate({ to: "/welcome" }); f.navigations.length = 0;
    f.flush = () => { const timers = [...f.timers.values()]; f.timers.clear(); for (const fn of timers) fn(); };
    delete require.cache[require.resolve(file)];
    return { f, api: require(file), local, preferences };
  }
  function component(f, fn) {
    const slots = []; let cleanups = [];
    return { render() {
      f.states = slots; f.cursor = 0; f.effects = [];
      const tree = fn(); const effects = [...f.effects];
      return { tree, commit() { cleanups.forEach(fn => fn()); cleanups = effects.map(fn => fn()).filter(fn => typeof fn === "function"); } };
    } };
  }
  const text = tree => JSON.stringify(tree);
  const paywall = tree => tree.props.children.find(child => child?.type === "paywall").props.open;
  for (const native of [false, true]) {
    // Only completed + authenticated Welcome maps to Home; no payload rewrite.
    {
      const { api } = setup(native);
      assert.equal(api.resolvePendingAuthReturnPath("/welcome", true, true), "/");
      assert.equal(api.resolvePendingAuthReturnPath("/welcome/?from=plus", true, true), "/");
      assert.equal(api.resolvePendingAuthReturnPath("/welcome", false, true), "/welcome");
      assert.equal(api.resolvePendingAuthReturnPath("/welcome", true, false), "/welcome");
      for (const path of ["/place?placeId=fixture", "/map", "/plan", "/chat", "/welcome-back"]) {
        assert.equal(api.resolvePendingAuthReturnPath(path, true, true), path);
      }
    }
    // A/B: a fresh device still sees onboarding; completion survives a new module/app boot.
    let { f, api, local, preferences } = setup(native);
    await api.loadOnboardingState();
    assert.equal(await api.resolveStartupPath({ hasSession: false, skipLog: true }), "/welcome");
    assert.match(text(component(f, api.WelcomeRoute.component).render().tree), /plusPurchase.intro1Title/);
    f.user = { id: "new-user-without-profile" };
    assert.equal(await api.resolveStartupPath({ hasSession: true, skipLog: true }), "/welcome");
    assert.equal(api.decideAppShellAfterAuthRestore({ onboardingCompleted: false, hasSessionUser: true }).kind, "welcome");
    api.stashPendingAuthAction({ action: "subscription_action", sourcePath: "/profile" });
    f.navigate({ to: "/login" });
    await api.navigateOnceAfterLogin(f.navigate, "login-session-restore");
    assert.equal(window.location.pathname, "/welcome", "pending action cannot bypass truly incomplete onboarding");
    assert.equal(api.isOnboardingCompletedSync(), false, "login never writes completion");
    await api.markOnboardingCompleted();
    ({ f, api } = setup(native, local, preferences));
    await api.loadOnboardingState();
    assert.equal(api.isOnboardingCompletedSync(), true);
    assert.equal(await api.resolveStartupPath({ hasSession: false, skipLog: true }), "/");
    assert.equal(api.decideAppShellAfterAuthRestore({ onboardingCompleted: true, hasSessionUser: false }).kind, "allow-guest");

    for (const [action, path, metadata] of [
      ["subscription_action", "/welcome", {}],
      ["subscription_action", "/", {}],
      ["favorite_write", "/place?placeId=fixture", { payload: JSON.stringify({ name: "fixture" }) }],
      ["trip_add_place", "/place?placeId=fixture", { payload: JSON.stringify({ placeName: "fixture" }), surface: "place" }],
      ["mood_shortcut", "/", { moodId: "relax" }],
      ["trip_generation", "/plan", {}],
      ["trip_create", "/plan", {}],
      ["ai_chat", "/chat", {}],
    ]) {
      ({ f, api } = setup(native, new Map([["onboarding_completed", "true"]]), new Map([["onboarding_completed", "true"]])));
      await api.loadOnboardingState();
      f.navigate({ to: path }); f.navigations.length = 0;
      const runtime = component(f, api.AuthActionRuntime);
      runtime.render().commit();
      const plus = component(f, () => api.PlusPurchaseProvider({ children: null }));
      plus.render().commit();
      f.openPlus = () => plus.render().tree.props.value.openRevenueCatPaywall();
      let resumes = 0;
      const listener = component(f, () => api.usePendingAuthActionResume(action, pending => { assert.equal(pending.action, action); resumes++; }));
      listener.render().commit();
      if (action === "subscription_action") assert.equal(f.openPlus(), "auth_required");
      else assert.equal(api.requireAuthForAction(action, metadata), false);
      const dialog = runtime.render().tree;
      assert.equal(dialog.props.open, true);
      assert.equal(api.peekPendingAuthAction(), null);
      dialog.props.onLogin();
      assert.equal(window.location.pathname, "/login");
      const pending = api.peekPendingAuthAction();
      assert.equal(pending.sourcePath, path);
      assert.equal(pending.action, action);
      runtime.render().commit(); f.flush();
      assert.equal(resumes, 0, "Guest cannot resume");
      f.user = { id: "new-user-no-profile-or-preferences" }; f.loading = true;
      f.navigate({ to: path }); runtime.render().commit(); f.flush();
      assert.equal(resumes, 0, "unsettled auth cannot resume");
      f.loading = false;
      if (path === "/welcome") {
        runtime.render().commit(); f.flush();
        assert.equal(resumes, 0, "Welcome is not the authenticated resume destination");
        assert.equal(api.peekPendingAuthAction().id, pending.id, "keep pending until Home runtime");
      }
      f.navigate({ to: native ? "/login" : "/auth/callback" });
      await api.navigateOnceAfterLogin(f.navigate, native ? "login-session-restore" : "auth-callback");
      const destination = path === "/welcome" ? "/" : path;
      assert.equal(window.location.pathname + window.location.search, destination);
      assert.equal(api.isOnboardingCompletedSync(), true);
      assert.equal(api.decideAppShellAfterAuthRestore({ onboardingCompleted: api.isOnboardingCompletedSync(), hasSessionUser: true }).kind, "allow-app");
      assert.equal(api.peekPendingAuthAction().sourcePath, path, "stored payload remains the original context");
      if (path === "/welcome") {
        assert.equal(window.location.pathname, "/", "completed authenticated Welcome returns to Home");
      }
      plus.render().commit();
      runtime.render().commit(); f.flush();
      assert.equal(resumes, 1, action);
      assert.equal(api.peekPendingAuthAction(), null);
      if (action === "subscription_action") {
        const opened = plus.render().tree;
        assert.equal(paywall(opened), true);
        opened.props.children.find(child => child?.type === "paywall").props.onOpenChange(false);
        assert.equal(paywall(plus.render().tree), false);
        assert.equal(window.location.pathname + window.location.search, destination, "closing paywall stays in destination");
      }
      assert.equal(f.favoriteWrites, action === "favorite_write" ? 1 : 0);
      assert.equal(f.tripWrites, action === "trip_add_place" ? 1 : 0);
      runtime.render().commit(); f.flush();
      assert.equal(resumes, 1, "remount cannot replay claimed action");
      if (action === "subscription_action") assert.equal(paywall(plus.render().tree), false, "remount cannot reopen closed paywall");
      assert.equal(f.favoriteWrites, action === "favorite_write" ? 1 : 0);
      assert.equal(f.tripWrites, action === "trip_add_place" ? 1 : 0);
      console.log(`PASS ${native ? "native" : "web"} ${action} ${path}: completed, original context, resume once`);
    }
  }
  const callback = readFileSync("src/routes/auth.callback.tsx", "utf8");
  assert.match(callback, /navigateOnceAfterLogin/);
  assert.match(callback, /search: opts.search/);
  assert.doesNotMatch(callback, /resolveAuthenticatedHomePath|finishPostAuthRedirect/);
  for (const [path, action] of [["src/routes/_app.index.tsx", "mood_shortcut"], ["src/routes/_app.plan.tsx", "trip_generation"], ["src/routes/_app.plan.tsx", "trip_create"], ["src/routes/_app.chat.tsx", "ai_chat"]]) {
    assert.ok(readFileSync(path, "utf8").includes(`usePendingAuthActionResume("${action}"`));
  }
  console.log("PASS Guest login onboarding continuation: fresh, cold boot, Apple/Google navigation, Plus/Favorite/AddToTrip/Mood/Planner");
} finally {
  stop(); rmSync(dir, { recursive: true, force: true });
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}
