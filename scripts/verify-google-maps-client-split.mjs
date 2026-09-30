import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  LEGACY_SHARED_CLIENT_MAPS_KEY_SHA256,
  applyMapsClientBuildEnv,
  mapsScriptQuerySource,
  resolveMapsClientInjection,
  sha256,
} from "./google-maps-client-authority.mjs";
import { verifyClientLogicParity, verifyMapsClientArtifact } from "./verify-google-client-bundle.mjs";

const repo = resolve(import.meta.dirname, "..");
const webKey = "AIza" + "w".repeat(35);
const iosKey = "AIza" + "i".repeat(35);
const legacyAlias = "AIza" + "l".repeat(35);
const serverKey = "AIza" + "s".repeat(35);

assert.equal(webKey.length, 39);
assert.notEqual(sha256(webKey), LEGACY_SHARED_CLIENT_MAPS_KEY_SHA256);
assert.throws(() => resolveMapsClientInjection("web", {}), /Missing required VITE_GOOGLE_MAPS_WEB_API_KEY/);
assert.throws(() => resolveMapsClientInjection("ios", { VITE_GOOGLE_MAPS_WEB_API_KEY: webKey }), /Missing required VITE_GOOGLE_MAPS_IOS_API_KEY/);
assert.throws(
  () =>
    resolveMapsClientInjection("web", {
      VITE_GOOGLE_MAPS_WEB_API_KEY: webKey,
      VITE_GOOGLE_MAPS_IOS_API_KEY: webKey,
    }),
  /must be distinct/,
);
assert.throws(
  () =>
    resolveMapsClientInjection("web", {
      VITE_GOOGLE_MAPS_WEB_API_KEY: legacyAlias,
      VITE_GOOGLE_MAPS_API_KEY: legacyAlias,
    }),
  /must not reuse VITE_GOOGLE_MAPS_API_KEY/,
);

const injection = resolveMapsClientInjection("web", {
  VITE_GOOGLE_MAPS_WEB_API_KEY: webKey,
  VITE_GOOGLE_MAPS_IOS_API_KEY: iosKey,
  VITE_GOOGLE_MAPS_API_KEY: legacyAlias,
  GOOGLE_PLACES_SERVER_API_KEY: serverKey,
});
const buildEnv = {
  VITE_GOOGLE_MAPS_WEB_API_KEY: webKey,
  VITE_GOOGLE_MAPS_IOS_API_KEY: iosKey,
  VITE_GOOGLE_MAPS_API_KEY: legacyAlias,
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: legacyAlias,
  GOOGLE_MAPS_API_KEY: legacyAlias,
  GOOGLE_PLACES_SERVER_API_KEY: serverKey,
};
applyMapsClientBuildEnv(buildEnv, injection);
assert.equal(buildEnv.VITE_GOOGLE_MAPS_CLIENT_API_KEY, webKey);
assert.equal(buildEnv.VITE_GOOGLE_MAPS_WEB_API_KEY, undefined);
assert.equal(buildEnv.VITE_GOOGLE_MAPS_IOS_API_KEY, undefined);
assert.equal(buildEnv.VITE_GOOGLE_MAPS_API_KEY, undefined);
assert.equal(buildEnv.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, undefined);
assert.equal(buildEnv.GOOGLE_MAPS_API_KEY, undefined);
assert.equal(JSON.stringify(buildEnv).includes(iosKey), false);
assert.equal(JSON.stringify(buildEnv).includes(legacyAlias), false);
assert.equal(buildEnv.ROAMIE_MAPS_CLIENT_TARGET, "web");

const iosInjection = resolveMapsClientInjection("ios", {
  VITE_GOOGLE_MAPS_WEB_API_KEY: webKey,
  VITE_GOOGLE_MAPS_IOS_API_KEY: iosKey,
});
const iosEnv = { VITE_GOOGLE_MAPS_WEB_API_KEY: webKey, VITE_GOOGLE_MAPS_IOS_API_KEY: iosKey };
applyMapsClientBuildEnv(iosEnv, iosInjection);
assert.equal(iosEnv.VITE_GOOGLE_MAPS_CLIENT_API_KEY, iosKey);
assert.equal(JSON.stringify(iosEnv).includes(webKey), false);
assert.equal(iosEnv.ROAMIE_MAPS_CLIENT_TARGET, "ios");

assert.match(mapsScriptQuerySource("web"), /authReferrerPolicy=origin/);
assert.equal(mapsScriptQuerySource("ios").includes("authReferrerPolicy"), false);
const loader = readFileSync(resolve(repo, "src/lib/google-maps-loader.ts"), "utf8");
assert.match(loader, /importLibrary\("maps"\)/);
assert.doesNotMatch(loader, /importLibrary\("(places|geocoding|routes)"\)/);
assert.doesNotMatch(loader, /authReferrerPolicy/);
assert.match(loader, /googleMapsScriptSrc/);
const server = readFileSync(resolve(repo, "src/lib/google-maps-key-resolve.server.ts"), "utf8");
assert.doesNotMatch(server, /VITE_GOOGLE_MAPS_WEB_API_KEY|VITE_GOOGLE_MAPS_IOS_API_KEY|VITE_GOOGLE_MAPS_CLIENT_API_KEY/);

const missing = spawnSync(process.execPath, ["scripts/production-build.mjs"], {
  cwd: repo,
  env: { ...process.env, VITE_GOOGLE_MAPS_WEB_API_KEY: "", VITE_GOOGLE_MAPS_IOS_API_KEY: "" },
  encoding: "utf8",
});
assert.notEqual(missing.status, 0);
assert.match(missing.stderr, /Missing required VITE_GOOGLE_MAPS_WEB_API_KEY/);

const webArtifact = join(tmpdir(), "roamie-maps-web-client");
const webAuthority = join(tmpdir(), "roamie-maps-web-authority.json");
const snapshot = join(tmpdir(), "roamie-maps-split-snapshot");
rmSync(snapshot, { recursive: true, force: true });
mkdirSync(snapshot, { recursive: true });
cpSync(resolve(repo, "src/generated/app-bundle-meta.ts"), join(snapshot, "app-bundle-meta.ts"));
cpSync(resolve(repo, "src/generated/maps-client-script-query.ts"), join(snapshot, "maps-client-script-query.ts"));
if (existsDir(resolve(repo, "dist"))) cpSync(resolve(repo, "dist"), join(snapshot, "dist"), { recursive: true });
if (existsDir(resolve(repo, "ios/App/App/public"))) {
  cpSync(resolve(repo, "ios/App/App/public"), join(snapshot, "ios-public"), { recursive: true });
}

const keys = {
  ...process.env,
  VITE_GOOGLE_MAPS_WEB_API_KEY: webKey,
  VITE_GOOGLE_MAPS_IOS_API_KEY: iosKey,
};
try {
  const webBuild = spawnSync("npm", ["run", "build"], { cwd: repo, env: keys, stdio: "inherit" });
  assert.equal(webBuild.status, 0, "canonical web build");
  rmSync(webArtifact, { recursive: true, force: true });
  cpSync(resolve(repo, "dist/client"), webArtifact, { recursive: true });
  cpSync(resolve(repo, "dist/maps-client-authority.json"), webAuthority);
  const webFailures = verifyMapsClientArtifact(
    webArtifact,
    JSON.parse(readFileSync(webAuthority, "utf8")),
    keys,
  );
  assert.deepEqual(webFailures, [], webFailures.join("\n"));
  const contract = spawnSync(process.execPath, ["scripts/verify-release-contract.mjs"], {
    cwd: repo,
    env: keys,
    stdio: "inherit",
  });
  assert.equal(contract.status, 0, "release contract");

  const iosBuild = spawnSync("npm", ["run", "ios:release"], { cwd: repo, env: keys, stdio: "inherit" });
  assert.equal(iosBuild.status, 0, "canonical ios release");
  const count = verifyClientLogicParity(webArtifact, resolve(repo, "ios/App/App/public"));
  assert.ok(count > 10);
  console.log("PASS maps client split unit, fail-fast, web build, ios release, logic parity", count);
} finally {
  cpSync(join(snapshot, "app-bundle-meta.ts"), resolve(repo, "src/generated/app-bundle-meta.ts"));
  cpSync(join(snapshot, "maps-client-script-query.ts"), resolve(repo, "src/generated/maps-client-script-query.ts"));
  rmSync(resolve(repo, "dist"), { recursive: true, force: true });
  if (existsDir(join(snapshot, "dist"))) cpSync(join(snapshot, "dist"), resolve(repo, "dist"), { recursive: true });
  rmSync(resolve(repo, "ios/App/App/public"), { recursive: true, force: true });
  if (existsDir(join(snapshot, "ios-public"))) {
    cpSync(join(snapshot, "ios-public"), resolve(repo, "ios/App/App/public"), { recursive: true });
  }
}

function existsDir(path) {
  return existsSync(path) && statSync(path).isDirectory();
}
