import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { resolveRestoreOutcome } from "../src/services/subscription/purchase-outcome.ts";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const result = (active, synced) => ({
  outcome: "success",
  status: { isActive: active },
  canonicalSynced: synced,
});
function harness(continuation = false) {
  let userId = "A",
    cursor = 0,
    mounted = true,
    writes = 0,
    tree,
    intent = continuation;
  const slots = [],
    effects = [],
    cleanups = [],
    toasts = [];
  const work = deferred();
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const React = {
    Fragment: "Fragment",
    createContext: () => ({ Provider: "Provider" }),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef: (initial) => slots[cursor++] ?? (slots[cursor - 1] = { current: initial }),
    useState: (initial) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value) => {
          writes++;
          assert.ok(mounted, "no unmounted setter");
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
        },
      ];
    },
    useMemo: (fn, deps) => {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useCallback: (fn, deps) => React.useMemo(() => fn, deps),
    useEffect: (fn, deps) => {
      const i = cursor++;
      if (changed(slots[i], deps)) {
        slots[i] = deps;
        effects.push(() => {
          cleanups[i]?.();
          cleanups[i] = fn();
        });
      }
    },
  };
  const t = (key) => key;
  const subscription = {
    packages: [{ identifier: "monthly", period: "monthly", priceString: "$1" }],
    offeringsState: "success",
    canonicalSyncError: "retry",
    loadOfferings: async () => {},
    purchase: () => work.promise,
    restore: () => work.promise,
    refresh: () => work.promise,
  };
  const dependencies = {
    react: React,
    "@tanstack/react-router": {
      Link: "Link",
      useNavigate: () => () => {},
      useRouterState: () => "/profile",
    },
    "lucide-react": { Sparkles: "Sparkles", X: "X" },
    sonner: {
      toast: Object.fromEntries(
        ["success", "error", "message"].map((k) => [k, (text) => toasts.push([k, text])]),
      ),
    },
    "@/components/LegalDocumentSheet": { LegalDocumentSheet: "Legal" },
    "@/components/PlusComingSoonDialog": { PlusComingSoonDialog: "Dialog" },
    "@/components/ui/alert-dialog": Object.fromEntries(
      [
        "AlertDialog",
        "AlertDialogAction",
        "AlertDialogCancel",
        "AlertDialogContent",
        "AlertDialogDescription",
        "AlertDialogFooter",
        "AlertDialogHeader",
        "AlertDialogTitle",
      ].map((k) => [k, k]),
    ),
    "@/hooks/use-access": { useAccess: () => ({ isPlusUser: false }) },
    "@/hooks/use-i18n": { useI18n: () => ({ t }) },
    "@/hooks/use-auth": {
      useAuth: () => ({ user: userId ? { id: userId } : null, loading: false }),
    },
    "@/lib/access/developer": { isDeveloperBuildEnabled: () => false },
    "@/lib/access/subscription-dev-mode": { canBypassSubscriptionBilling: () => false },
    "@/providers/SubscriptionProvider": { useSubscription: () => subscription },
    "@/lib/open-subscription-settings": { openSubscriptionManagement: () => {} },
    "@/services/subscription/purchase-outcome": { resolveRestoreOutcome },
    "@/lib/subscription/purchase-continuation": {
      consumePlusPurchaseContinuation: () => {
        const value = intent;
        intent = false;
        return value ? "restore_purchases" : null;
      },
      clearPlusPurchaseContinuation: () => {},
      savePlusPurchaseContinuation: () => {},
    },
  };
  function load(path) {
    const output = ts.transpileModule(
      fs.readFileSync(path, "utf8").replaceAll("import.meta.env.DEV", "false"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.React,
        },
      },
    ).outputText;
    const exports = {};
    new Function("require", "exports", "React", output)(
      (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
      exports,
      React,
    );
    return exports;
  }
  dependencies["@/hooks/use-subscription-operation"] = load(
    "src/hooks/use-subscription-operation.ts",
  );
  const Component = continuation
    ? load("src/providers/PlusPurchaseProvider.tsx").PlusPurchaseProvider
    : load("src/components/RoamiePlusIntroDialog.tsx").RoamiePlusIntroDialog;
  const render = () => {
    cursor = 0;
    tree = Component({
      open: true,
      children: null,
      onOpenChange: () => {
        writes++;
      },
      onUpgraded: () => {
        writes++;
      },
    });
    for (const effect of effects.splice(0)) effect();
  };
  function nodes(value) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(nodes);
    return [value, ...nodes(value.props?.children)];
  }
  render();
  return {
    work,
    toasts,
    get writes() {
      return writes;
    },
    switchUser(id) {
      userId = id;
      render();
    },
    unmount() {
      for (const cleanup of cleanups) cleanup?.();
      mounted = false;
    },
    start(kind) {
      const node = nodes(tree).find((n) =>
        kind === "purchase"
          ? n.type === "AlertDialogAction"
          : n.type === "button" &&
            JSON.stringify(n.props.children).includes(
              `plusPurchase.${kind === "sync" ? "syncRetry" : "restore"}`,
            ),
      );
      assert.ok(node, kind);
      node.props.onClick({ preventDefault() {} });
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
for (const [active, synced, expected] of [
  [true, true, "restored"],
  [true, false, "restoreSyncPending"],
  [false, true, "nothingToRestore"],
  [false, false, "nothingToRestore"],
]) {
  for (const continuation of [false, true]) {
    const h = harness(continuation);
    if (!continuation) h.start("restore");
    h.work.resolve(result(active, synced));
    await settle();
    assert.equal(h.toasts.at(-1)[1], `plusPurchase.${expected}`);
    h.unmount();
  }
}
for (const continuation of [false, true]) {
  const h = harness(continuation);
  if (!continuation) h.start("restore");
  h.work.reject(new Error("failure"));
  await settle();
  assert.deepEqual(h.toasts, [["error", "plusPurchase.restoreFailed"]]);
  h.unmount();
}
for (const kind of ["purchase", "restore", "sync", "continuation"]) {
  for (const transition of ["unmount", "account", "roundtrip"]) {
    for (const rejects of [false, true]) {
      // refresh's provider contract resolves false on failure; it never rejects.
      if (kind === "sync" && rejects) continue;
      const h = harness(kind === "continuation");
      if (kind !== "continuation") h.start(kind);
      if (transition === "unmount") h.unmount();
      else {
        h.switchUser(null);
        h.switchUser("B");
        if (transition === "roundtrip") h.switchUser("A");
      }
      const before = h.writes;
      if (rejects) h.work.reject(new Error("stale"));
      else h.work.resolve(kind === "sync" ? true : result(true, true));
      await settle();
      assert.equal(h.writes, before, `${kind}/${transition}: stale writes`);
      assert.deepEqual(h.toasts, [], `${kind}/${transition}: stale toast`);
      if (transition !== "unmount") h.unmount();
    }
  }
}
console.log(
  "Plus UI lifecycle: PASS (real dialog/continuation, restore precedence, failure, unmount, A/logout/B/A, resync)",
);
