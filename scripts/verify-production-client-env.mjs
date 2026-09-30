import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  PUBLIC_CLIENT_ENV_KEYS,
  SERVER_ONLY_ENV_KEYS,
  selectPublicClientEnv,
  validateRequiredPublicClientEnv,
} from "./public-client-env.mjs";

test("missing required native public config fails validation", () => {
  assert.deepEqual(validateRequiredPublicClientEnv({}), [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_APP_ORIGIN",
  ]);
});

test("complete native public config passes validation", () => {
  assert.deepEqual(
    validateRequiredPublicClientEnv({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
      VITE_APP_ORIGIN: "https://roamie.example",
    }),
    [],
  );
});

test("unsplash access key is server-only", () => {
  assert.equal(PUBLIC_CLIENT_ENV_KEYS.includes("VITE_UNSPLASH_ACCESS_KEY"), false);
  assert.equal(SERVER_ONLY_ENV_KEYS.includes("UNSPLASH_ACCESS_KEY"), true);
  const selected = selectPublicClientEnv(
    {
      VITE_UNSPLASH_ACCESS_KEY: "public-unsplash",
      UNSPLASH_ACCESS_KEY: "server-unsplash",
      VITE_APP_ORIGIN: "https://roamie.example",
    },
    { VITE_UNSPLASH_ACCESS_KEY: "shell-unsplash" },
  );
  assert.equal(selected.VITE_UNSPLASH_ACCESS_KEY, undefined);
  assert.equal(selected.UNSPLASH_ACCESS_KEY, undefined);
  const build = readFileSync(new URL("./production-build.mjs", import.meta.url), "utf8");
  assert.match(build, /delete buildEnv\.VITE_UNSPLASH_ACCESS_KEY/);
  assert.match(build, /delete buildEnv\.UNSPLASH_ACCESS_KEY/);
});

test("allowlist never preserves server credentials", () => {
  const source = Object.fromEntries([
    ...PUBLIC_CLIENT_ENV_KEYS.map((key) => [key, `public-${key}`]),
    ...SERVER_ONLY_ENV_KEYS.map((key) => [key, `secret-${key}`]),
  ]);
  const selected = selectPublicClientEnv(source, {});
  for (const key of SERVER_ONLY_ENV_KEYS) assert.equal(selected[key], undefined);
});

test("production build hides env files only after preserving public config", () => {
  const source = readFileSync(new URL("./production-build.mjs", import.meta.url), "utf8");
  assert.ok(source.indexOf("loadPublicClientEnv(root)") < source.indexOf("renameSync(source, hidden)"));
  assert.match(source, /buildEnv = \{ \.\.\.process\.env, \.\.\.publicClientEnv \}/);
  assert.match(source, /finally[\s\S]*renameSync\(hidden, source\)/);
});
