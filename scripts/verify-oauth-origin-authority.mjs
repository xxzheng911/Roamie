import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { parse } from "@babel/parser";
const actual = new Set([
  "@/lib/auth-redirect",
  "@/lib/oauth-origin-authority",
  "@/constants/auth-redirect",
  "@/constants/app",
]);
const exportsByModule = new Map();
for (const file of ["src/lib/auth-oauth.ts", "src/lib/auth-redirect.ts"]) {
  const ast = parse(fs.readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: ["typescript"],
  });
  for (const n of ast.program.body)
    if (n.type === "ImportDeclaration" && !actual.has(n.source.value)) {
      const names = exportsByModule.get(n.source.value) ?? new Set();
      for (const s of n.specifiers)
        if (s.type === "ImportSpecifier" && s.importKind !== "type") names.add(s.imported.name);
      exportsByModule.set(n.source.value, names);
    }
}
const overrides = {
  detectPlatform: "()=>globalThis.__oauthPlatform",
  isOAuthProviderEnabled: "()=>true",
  assertSupabaseConfiguredForAuth: "()=>null",
  readSupabaseProjectUrl: "()=>null",
  supabase:
    '{auth:{signInWithOAuth:async input=>{globalThis.__oauthCalls.push(input);return {data:null,error:{message:"controlled-stop"}}}}}',
  Browser: "{}",
};
async function load(dev) {
  const out = await build({
    stdin: {
      contents:
        'export * from "@/lib/auth-oauth"; export * from "@/lib/auth-redirect"; export * from "@/lib/oauth-origin-authority";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    define: { "import.meta.env.DEV": String(dev) },
    plugins: [
      {
        name: "controlled-dependencies",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (exportsByModule.has(a.path)) return { path: a.path, namespace: "mock" };
            if (a.path.startsWith("@/"))
              return { path: path.resolve("src", a.path.slice(2) + ".ts") };
          });
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents: [...exportsByModule.get(a.path)]
              .map((n) => `export const ${n}=${overrides[n] ?? "()=>undefined"};`)
              .join("\n"),
          }));
        },
      },
    ],
  });
  return import(
    "data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64")
  );
}
globalThis.__oauthPlatform = { isCapacitor: false, isNative: false, isIOS: false };
globalThis.__oauthCalls = [];
globalThis.sessionStorage = { setItem() {} };
const m = await load(false);
const good = [
  "https://roamie.tw",
  "https://6ea580e7-roamie.vvbwb6bw52.workers.dev",
  "https://abcdef09-roamie.vvbwb6bw52.workers.dev",
];
const bad = [
  "",
  "null",
  "not a URL",
  "https://roamie.tw.evil.test",
  "https://evil-roamie.vvbwb6bw52.workers.dev",
  "https://6ea580e7-roamie.other.workers.dev",
  "https://6ea580e7-evil.vvbwb6bw52.workers.dev",
  "https://staging-roamie.vvbwb6bw52.workers.dev",
  "http://roamie.tw",
  "http://localhost:8080",
  "https://roamie.tw:443",
  "https://roamie.tw:8443",
  "https://user@roamie.tw",
  "https://user:pass@roamie.tw",
  "https://roamie.tw/",
  "https://roamie.tw/path",
  "https://roamie.tw?next=evil",
  "https://roamie.tw#x",
  "https://roamie.tw\\evil",
  "https://%72oamie.tw",
  "https://roamie.tw.",
  "https://6EA580E7-roamie.vvbwb6bw52.workers.dev",
  "https://gea580e7-roamie.vvbwb6bw52.workers.dev",
  "https://6ea580e-roamie.vvbwb6bw52.workers.dev",
  "https://6ea580e77-roamie.vvbwb6bw52.workers.dev",
  " https://roamie.tw",
  "https://roamie.tw\n",
  "https://roamie.tw@evil.test",
];
for (const origin of good) {
  assert.equal(m.validateOAuthOrigin(origin), origin);
  globalThis.window = { location: { origin } };
  assert.equal(m.getOAuthRedirectUrl(), origin + "/auth/callback");
  for (const provider of ["google", "apple"]) {
    await m.startOAuthSignIn(provider);
    assert.deepEqual(globalThis.__oauthCalls.at(-1), {
      provider,
      options: { redirectTo: origin + "/auth/callback", skipBrowserRedirect: true },
    });
  }
  assert.equal(m.isOAuthDeepLinkUrl(origin + "/auth/callback?code=synthetic"), true);
}
for (const origin of bad) {
  assert.throws(() => m.validateOAuthOrigin(origin), /oauth_origin_not_allowed/);
  globalThis.window = { location: { origin } };
  const count = globalThis.__oauthCalls.length;
  for (const provider of ["google", "apple"])
    await assert.rejects(m.startOAuthSignIn(provider), /oauth_origin_not_allowed/);
  assert.equal(globalThis.__oauthCalls.length, count);
}
for (const isIOS of [true, false]) {
  globalThis.__oauthPlatform = { isCapacitor: true, isNative: true, isIOS };
  assert.equal(m.getOAuthRedirectUrl(), "roamie://auth/callback");
}
assert.equal(m.isOAuthDeepLinkUrl("roamie://auth/callback?code=synthetic"), true);
assert.equal(m.isOAuthDeepLinkUrl("https://roamie.tw:443/auth/callback"), false);
assert.equal(m.isOAuthDeepLinkUrl("https://user@roamie.tw/auth/callback"), false);
globalThis.__oauthPlatform = { isCapacitor: false, isNative: false, isIOS: false };
const dev = await load(true);
globalThis.window = { location: { origin: "http://localhost:8080" } };
assert.equal(dev.getOAuthRedirectUrl(), "http://localhost:8080/auth/callback");
assert.throws(() => dev.validateOAuthOrigin("http://localhost:9999", true));
console.log(
  `PASS production/native/preview/dev authority; ${bad.length} rejected origins; actual Google + Apple Web signInWithOAuth redirectTo; no network`,
);
