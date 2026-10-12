import assert from "node:assert/strict";
import {
  collectDebugDiagnosticsFailures,
  debugDiagnosticsPolicy,
} from "./verify-release-artifacts.mjs";

// Artifact detector: Vite inlines import.meta.env into client chunks.
const client = "/r/dist/client/assets/index-x.js";
const ios = "/r/ios/App/App/public/assets/index-x.js";
for (const [path, text, debug] of [
  [client, 'const e={BASE_URL:"./",VITE_DEBUG_DIAGNOSTICS:"1",DEV:!1};', true],
  [client, '{"VITE_VERBOSE_LOG":"1"}', true],
  [ios, "{VITE_DEBUG_DIAGNOSTICS: '1'}", true],
  [client, 'const e={BASE_URL:"./",DEV:!1};', false],
  [client, '{VITE_DEBUG_DIAGNOSTICS:"0"}', false],
  [client, 'if(e.VITE_DEBUG_DIAGNOSTICS==="1")log()', false],
  ["/r/dist/server/assets/x.js", '{VITE_DEBUG_DIAGNOSTICS:"1"}', false],
  ["/r/dist/client/index.html", '{VITE_DEBUG_DIAGNOSTICS:"1"}', false],
]) {
  assert.equal(collectDebugDiagnosticsFailures(path, text).length > 0, debug, `${path} ${text}`);
}

// Policy: only an explicitly requested debug `npm run build` may keep diagnostics.
const policy = (env) => debugDiagnosticsPolicy(env);
assert.deepEqual(policy({ npm_lifecycle_event: "postbuild", VITE_DEBUG_DIAGNOSTICS: "1" }), { allow: true, scanIos: false });
assert.deepEqual(policy({ npm_lifecycle_event: "postbuild", VITE_VERBOSE_LOG: "1" }), { allow: true, scanIos: false });
assert.deepEqual(policy({ npm_lifecycle_event: "postbuild" }), { allow: false, scanIos: false });
for (const release of ["verify:release-artifacts", "ios:release", "cap:sync:ios:release", "release:worker:upload", undefined]) {
  assert.deepEqual(policy({ npm_lifecycle_event: release, VITE_DEBUG_DIAGNOSTICS: "1" }), { allow: false, scanIos: true }, `${release} is strict`);
}
console.log("PASS release debug diagnostics guard: artifact detector + strict release policy");
