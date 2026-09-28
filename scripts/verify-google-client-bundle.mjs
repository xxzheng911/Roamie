import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseEnv as parse } from "node:util";
const serverNames = [
  "GOOGLE_PLACES_SERVER_API_KEY",
  "GOOGLE_ROUTES_SERVER_API_KEY",
  "GOOGLE_GEOCODING_SERVER_API_KEY",
];
const publicNames = ["VITE_GOOGLE_MAPS_API_KEY", "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"];
const fingerprint = (value) => createHash("sha256").update(value).digest("hex").slice(0, 12) + "…";
const values = new Map();
for (const source of [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".dev.vars",
]) {
  if (!fs.existsSync(source)) continue;
  for (const [name, value] of Object.entries(parse(fs.readFileSync(source, "utf8"))))
    if ([...serverNames, ...publicNames].includes(name) && value)
      values.set(name + ":" + fingerprint(value), { name, value });
}
for (const name of [...serverNames, ...publicNames])
  if (process.env[name]) values.set(name + ":runtime", { name, value: process.env[name] });
function files(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(path.join(root, e.name)) : [path.join(root, e.name)]));
}
function inspect(content) {
  const failures = [];
  for (const name of serverNames)
    if (content.includes(name)) failures.push("server authority name " + name);
  for (const { name, value } of values.values())
    if (serverNames.includes(name) && content.includes(value))
      failures.push(name + " " + fingerprint(value));
  return failures;
}
// Negative controls ensure the scanner would catch both authority names and literal secrets.
assert.ok(inspect(serverNames[0]).length);
for (const { name, value } of values.values())
  if (serverNames.includes(name)) assert.ok(inspect(value).length);
const roots = ["dist/client", "ios/App/App/public"];
for (const root of roots) {
  const all = files(root);
  const bytes = all.map((f) => fs.readFileSync(f).toString("utf8")).join("\n");
  assert.deepEqual(inspect(bytes), [], "server credential exposure in " + root);
  assert.ok(bytes.includes("/api/google"), "latest authenticated proxy missing in " + root);
  const found = [...new Set(bytes.match(/AIza[\w-]{35}/g) || [])];
  const allowed = [...values.values()]
    .filter((v) => publicNames.includes(v.name))
    .map((v) => v.value);
  for (const key of found)
    assert.ok(
      allowed.includes(key),
      "unrecognized Google credential fingerprint " + fingerprint(key),
    );
  console.log(
    "PASS",
    root,
    "files=" + all.length,
    "client Google fingerprints=" + found.map(fingerprint).join(","),
    "server exposure=NO",
  );
}
let parity = 0;
for (const f of files("dist/client")) {
  const rel = path.relative("dist/client", f);
  if (!/\.(?:js|css)$/.test(rel)) continue;
  const ios = path.join("ios/App/App/public", rel);
  assert.ok(fs.existsSync(ios), "missing iOS asset " + rel);
  assert.ok(fs.readFileSync(f).equals(fs.readFileSync(ios)), "asset mismatch " + rel);
  parity++;
}
for (const name of serverNames) {
  const known = [...values.values()].filter((v) => v.name === name);
  console.log(
    name,
    known.length
      ? [...new Set(known.map((v) => fingerprint(v.value)))].join(",") + " absent from both bundles"
      : "not configured locally; authority name absent from both bundles",
  );
}
console.log("PASS negative scanner controls and build/iOS JS+CSS parity", parity);
