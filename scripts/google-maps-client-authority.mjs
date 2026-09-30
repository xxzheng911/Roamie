import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Build 85 client Maps key. Value is not stored; release artifacts must not contain it. */
export const LEGACY_SHARED_CLIENT_MAPS_KEY_SHA256 =
  "6f6e276de97c8967b75339963034fcb1aa4cb5d808580d71bfc2602d413df50e";

export const MAPS_CLIENT_AUTHORITIES = Object.freeze({
  web: "VITE_GOOGLE_MAPS_WEB_API_KEY",
  ios: "VITE_GOOGLE_MAPS_IOS_API_KEY",
});

/** Single slot compiled into one artifact. Not a third stored authority. */
export const INJECTED_MAPS_CLIENT_KEY = "VITE_GOOGLE_MAPS_CLIENT_API_KEY";

export const LEGACY_CLIENT_MAPS_KEY_NAMES = Object.freeze([
  "VITE_GOOGLE_MAPS_API_KEY",
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
  "GOOGLE_MAPS_API_KEY",
]);

export const SERVER_GOOGLE_KEY_NAMES = Object.freeze([
  "GOOGLE_PLACES_SERVER_API_KEY",
  "GOOGLE_ROUTES_SERVER_API_KEY",
  "GOOGLE_GEOCODING_SERVER_API_KEY",
]);

export const MAPS_SCRIPT_QUERY_RELATIVE = "src/generated/maps-client-script-query.ts";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprint(value) {
  return sha256(value).slice(0, 12);
}

function read(env, name) {
  const raw = env?.[name];
  return typeof raw === "string" ? raw.trim() : "";
}

export function mapsClientModeFromArgv(argv) {
  const arg = argv.find((item) => item.startsWith("--maps-client="));
  if (!arg) return "web";
  const mode = arg.slice("--maps-client=".length);
  if (mode !== "web" && mode !== "ios") {
    throw new Error("Unsupported --maps-client value: " + mode);
  }
  return mode;
}

/**
 * Selects exactly one client authority. Legacy names are never a fallback.
 * The selected value must be distinct from the other client authority and from legacy values.
 */
export function resolveMapsClientInjection(mode, env) {
  if (mode !== "web" && mode !== "ios") throw new Error("Maps client build mode must be web or ios");
  const name = MAPS_CLIENT_AUTHORITIES[mode];
  const otherName = MAPS_CLIENT_AUTHORITIES[mode === "web" ? "ios" : "web"];
  const value = read(env, name);
  if (!value) throw new Error("Missing required " + name);
  if (!value.startsWith("AIza")) throw new Error(name + " is not a Maps client key");
  if (sha256(value) === LEGACY_SHARED_CLIENT_MAPS_KEY_SHA256) {
    throw new Error(name + " reuses the legacy shared client Maps key");
  }
  const other = read(env, otherName);
  if (other && other === value) throw new Error("Web and iOS Maps client keys must be distinct");
  for (const legacy of LEGACY_CLIENT_MAPS_KEY_NAMES) {
    const legacyValue = read(env, legacy);
    if (legacyValue && legacyValue === value) throw new Error(name + " must not reuse " + legacy);
  }
  return {
    mode,
    name,
    value,
    authReferrerPolicy: mode === "web" ? "origin" : null,
  };
}

export function applyMapsClientBuildEnv(buildEnv, injection) {
  for (const name of [
    ...Object.values(MAPS_CLIENT_AUTHORITIES),
    ...LEGACY_CLIENT_MAPS_KEY_NAMES,
    INJECTED_MAPS_CLIENT_KEY,
  ]) {
    delete buildEnv[name];
  }
  buildEnv[INJECTED_MAPS_CLIENT_KEY] = injection.value;
  buildEnv.ROAMIE_MAPS_CLIENT_TARGET = injection.mode;
  return injection;
}

export function mapsScriptQuerySource(mode) {
  const suffix = mode === "web" ? "&authReferrerPolicy=origin" : "";
  return `/** Generated for one Maps client build. iOS bundled builds keep this suffix empty. */\nexport const mapsScriptQuerySuffix = ${JSON.stringify(suffix)};\n`;
}

export function writeMapsScriptQuery(root, mode) {
  const path = resolve(root, MAPS_SCRIPT_QUERY_RELATIVE);
  const previous = readFileSync(path);
  writeFileSync(path, mapsScriptQuerySource(mode));
  return { path, previous };
}

export function writeMapsClientAuthority(distDir, injection) {
  const body = {
    mode: injection.mode,
    authority: injection.name,
    keySha256: sha256(injection.value),
    authReferrerPolicy: injection.authReferrerPolicy,
  };
  writeFileSync(resolve(distDir, "maps-client-authority.json"), JSON.stringify(body, null, 2) + "\n");
  return body;
}
