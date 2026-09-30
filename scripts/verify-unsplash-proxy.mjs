import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveApiUrl } from "../src/lib/api-url.ts";
import { resolveUnsplashAccessKey } from "../src/lib/unsplash-key.server.ts";
import { handleUnsplashProxy } from "../src/lib/unsplash-proxy.server.ts";
import { getPlaceImage, getTripCoverImage } from "../src/services/placeImageService.ts";
import {
  searchUnsplashImage,
  searchUnsplashWithQueries,
  unsplashSearchClient,
} from "../src/services/unsplashService.ts";
import {
  collectUnsplashLeakFailures,
  textHasRetiredUnsplashAccessKey,
} from "./verify-release-artifacts.mjs";

const STYLE_SUFFIX = "soft pastel cinematic travel lifestyle aesthetic";
const PHOTO = "https://images.unsplash.com/photo-proxy-fixture";
const savedClient = {
  getAccessToken: unsplashSearchClient.getAccessToken,
  fetchImpl: unsplashSearchClient.fetchImpl,
  resolveUrl: unsplashSearchClient.resolveUrl,
};
const savedEnv = {
  UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY,
  VITE_UNSPLASH_ACCESS_KEY: process.env.VITE_UNSPLASH_ACCESS_KEY,
};

function restoreEnv(name) {
  if (savedEnv[name] === undefined) delete process.env[name];
  else process.env[name] = savedEnv[name];
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function proxyRequest(body, init = {}) {
  return new Request("https://roamie.test/api/unsplash", {
    method: init.method ?? "POST",
    headers: {
      origin: "https://roamie.test",
      authorization: "Bearer session-token",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validBody = {
  query: `京都 旅行 ${STYLE_SUFFIX}`,
  per_page: 5,
  orientation: "landscape",
  content_filter: "high",
};

function readServerKeyFromEnvFile() {
  let text;
  try {
    text = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0 || trimmed.slice(0, eq).trim() !== "UNSPLASH_ACCESS_KEY") continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }
  return null;
}

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test("server key ignores public client env", () => {
  delete process.env.UNSPLASH_ACCESS_KEY;
  process.env.VITE_UNSPLASH_ACCESS_KEY = "vite-must-not-be-used";
  assert.equal(resolveUnsplashAccessKey({ VITE_UNSPLASH_ACCESS_KEY: "vite-must-not-be-used" }), null);
  assert.equal(resolveUnsplashAccessKey({ UNSPLASH_ACCESS_KEY: "  server-key  " }), "server-key");
  assert.equal(resolveUnsplashAccessKey({ UNSPLASH_ACCESS_KEY: "   " }), null);
  assert.equal(resolveUnsplashAccessKey({}), null);
});

test("proxy rejects missing session, malformed payload, and open-proxy fields", async () => {
  let upstream = 0;
  const deps = {
    authenticate: async () => "user-1",
    resolveAccessKey: () => "fixture-server-key",
    fetchImpl: async () => {
      upstream += 1;
      return jsonResponse({ results: [] });
    },
  };
  assert.equal((await handleUnsplashProxy(proxyRequest(validBody, { headers: { authorization: "" } }), {}, deps)).status, 401);
  assert.equal(
    (await handleUnsplashProxy(proxyRequest(validBody), {}, { ...deps, authenticate: async () => null })).status,
    401,
  );
  assert.equal((await handleUnsplashProxy(proxyRequest("{"), {}, deps)).status, 400);
  assert.equal((await handleUnsplashProxy(proxyRequest({ ...validBody, url: "https://evil.example" }), {}, deps)).status, 400);
  assert.equal((await handleUnsplashProxy(proxyRequest({ ...validBody, client_id: "client-picked" }), {}, deps)).status, 400);
  assert.equal(
    (await handleUnsplashProxy(proxyRequest({ ...validBody, headers: { Authorization: "Client-ID client" } }), {}, deps)).status,
    400,
  );
  assert.equal((await handleUnsplashProxy(proxyRequest({ ...validBody, per_page: 30 }), {}, deps)).status, 400);
  assert.equal((await handleUnsplashProxy(proxyRequest(validBody, { headers: { origin: "https://evil.example" } }), {}, deps)).status, 403);
  assert.equal((await handleUnsplashProxy(new Request("https://roamie.test/api/unsplash"), {}, deps)).status, 405);
  assert.equal(upstream, 0);
});

test("missing secret and upstream failure do not retry or use a client credential", async () => {
  delete process.env.UNSPLASH_ACCESS_KEY;
  process.env.VITE_UNSPLASH_ACCESS_KEY = "vite-must-not-be-used";
  let upstream = 0;
  const deps = {
    authenticate: async () => "user-1",
    resolveAccessKey: resolveUnsplashAccessKey,
    fetchImpl: async () => {
      upstream += 1;
      throw new Error("must not fetch");
    },
  };
  const missing = await handleUnsplashProxy(proxyRequest(validBody), { VITE_UNSPLASH_ACCESS_KEY: "vite-must-not-be-used" }, deps);
  assert.equal(missing.status, 503);
  assert.equal(upstream, 0);

  const failed = await handleUnsplashProxy(proxyRequest(validBody), { UNSPLASH_ACCESS_KEY: "fixture-server-key" }, {
    ...deps,
    fetchImpl: async () => {
      upstream += 1;
      return jsonResponse({ error: "nope" }, 500);
    },
  });
  assert.equal(failed.status, 502);
  assert.equal(upstream, 1);
  const thrown = await handleUnsplashProxy(proxyRequest(validBody), { UNSPLASH_ACCESS_KEY: "fixture-server-key" }, {
    ...deps,
    fetchImpl: async () => {
      upstream += 1;
      throw new Error("network");
    },
  });
  assert.equal(thrown.status, 502);
  assert.equal(upstream, 2);
});

test("authorized search uses the server secret once and keeps result order", async () => {
  const calls = [];
  const response = await handleUnsplashProxy(proxyRequest(validBody, { headers: { origin: "capacitor://localhost" } }), {
    UNSPLASH_ACCESS_KEY: "fixture-server-key",
    VITE_UNSPLASH_ACCESS_KEY: "vite-must-not-be-used",
  }, {
    authenticate: async () => "user-1",
    resolveAccessKey: resolveUnsplashAccessKey,
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return jsonResponse({
        results: [
          { urls: { thumb: "https://images.unsplash.com/thumb" }, extra: "drop" },
          { urls: { regular: PHOTO, small: `${PHOTO}?w=400` }, user: { name: "Lee", bio: "secret" } },
        ],
      });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin + calls[0].url.pathname, "https://api.unsplash.com/search/photos");
  assert.equal(calls[0].url.searchParams.get("query"), validBody.query);
  assert.equal(calls[0].url.searchParams.get("per_page"), "5");
  assert.equal(calls[0].url.searchParams.get("orientation"), "landscape");
  assert.equal(calls[0].url.searchParams.get("content_filter"), "high");
  assert.equal(calls[0].url.searchParams.get("client_id"), null);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.Authorization, "Client-ID fixture-server-key");
  assert.equal(calls[0].init.headers.Authorization.includes("session-token"), false);
  const body = await response.json();
  assert.equal(body.results.length, 2);
  assert.equal(body.results[1].urls.regular, PHOTO);
  assert.equal(body.results[1].user.name, "Lee");
  assert.equal(JSON.stringify(body).includes("fixture-server-key"), false);
  assert.equal(JSON.stringify(body).includes("bio"), false);
  assert.equal((await handleUnsplashProxy(proxyRequest(validBody), { DISABLE_UNSPLASH_PROXY: "1", UNSPLASH_ACCESS_KEY: "fixture-server-key" }, {
    authenticate: async () => "user-1",
    resolveAccessKey: () => "fixture-server-key",
    fetchImpl: async () => {
      throw new Error("kill switch must not fetch");
    },
  })).status, 503);
});

test("client search keeps cache, dedupe, fallback, and one proxy request", async () => {
  const calls = [];
  unsplashSearchClient.getAccessToken = async () => "session-token";
  unsplashSearchClient.resolveUrl = (path) => `https://roamie.test${path}`;
  unsplashSearchClient.fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const query = JSON.parse(init.body).query;
    if (query.startsWith("empty-result")) return jsonResponse({ results: [] });
    return jsonResponse({
      results: [
        { urls: {} },
        { urls: { regular: PHOTO }, user: { name: "Lee" } },
      ],
    });
  };
  const query = `cache-parity-${Date.now()}`;
  const first = await searchUnsplashImage(query);
  const second = await searchUnsplashImage(query);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://roamie.test/api/unsplash");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer session-token");
  assert.equal(String(calls[0].init.headers.Authorization).includes("Client-ID"), false);
  assert.equal(JSON.parse(calls[0].init.body).query, `${query} ${STYLE_SUFFIX}`);
  assert.equal(JSON.parse(calls[0].init.body).per_page, 5);
  assert.ok(first?.url.includes("images.unsplash.com"));
  assert.equal(first?.photographer, "Lee");
  assert.equal(second?.url, first?.url);
  const misses = await searchUnsplashWithQueries([`empty-result-${Date.now()}`, `hit-${Date.now()}`]);
  assert.equal(calls.length, 3);
  assert.ok(misses?.url.includes("images.unsplash.com"));
  unsplashSearchClient.getAccessToken = async () => null;
  assert.equal(await searchUnsplashImage(`signed-out-${Date.now()}`), null);
  assert.equal(calls.length, 3);
});

test("trip cover and place image keep selection fallback without extra searches", async () => {
  let upstream = 0;
  unsplashSearchClient.getAccessToken = async () => "session-token";
  unsplashSearchClient.resolveUrl = (path) => `https://roamie.test${path}`;
  unsplashSearchClient.fetchImpl = async (_url, init) =>
    handleUnsplashProxy(new Request("https://roamie.test/api/unsplash", init), { UNSPLASH_ACCESS_KEY: "fixture-server-key" }, {
      authenticate: async () => "user-1",
      resolveAccessKey: () => "fixture-server-key",
      fetchImpl: async () => {
        upstream += 1;
        return jsonResponse({ results: [{ urls: { regular: PHOTO }, user: { name: "Lee" } }] });
      },
    });
  const trip = { destination: `京都封面${Date.now()}` };
  const [first, second] = await Promise.all([getTripCoverImage(trip), getTripCoverImage(trip)]);
  assert.equal(first.source, "unsplash");
  assert.equal(second.url, first.url);
  assert.equal(first.url.includes("images.unsplash.com"), true);
  assert.equal(upstream, 1);
  const again = await getTripCoverImage(trip);
  assert.equal(again.url, first.url);
  assert.equal(upstream, 1);
  const place = await getPlaceImage(
    { name: `咖啡測試${Date.now()}`, city: "台北", category: "coffee" },
    { skipGoogle: true },
  );
  assert.equal(place.source, "unsplash");
  assert.equal(place.url.includes("images.unsplash.com"), true);
  assert.equal(upstream, 2);
  unsplashSearchClient.getAccessToken = async () => null;
  const fallback = await getTripCoverImage({ destination: `無登入封面${Date.now()}` });
  assert.equal(fallback.source, "roamie");
  assert.equal(upstream, 2);
});

test("native and web clients use the same-origin proxy path", () => {
  assert.equal(resolveApiUrl("/api/unsplash", { native: false }), "/api/unsplash");
  assert.equal(
    resolveApiUrl("/api/unsplash", { native: true, origin: "https://roamie.tw" }),
    "https://roamie.tw/api/unsplash",
  );
});

test("source and release scanner separate image hosts from the api credential", () => {
  const client = readFileSync(new URL("../src/services/unsplashService.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../src/lib/unsplash-proxy.server.ts", import.meta.url), "utf8");
  const key = readFileSync(new URL("../src/lib/unsplash-key.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /api\.unsplash\.com|VITE_UNSPLASH_ACCESS_KEY|UNSPLASH_ACCESS_KEY|Client-ID/);
  assert.match(client, /\/api\/unsplash/);
  assert.match(server, /api\.unsplash\.com\/search\/photos/);
  assert.match(server, /Client-ID/);
  assert.doesNotMatch(server + key, /VITE_UNSPLASH_ACCESS_KEY/);
  assert.doesNotMatch(server, /abuse-guard\.server/);
  const image = "https://images.unsplash.com/photo-allowed";
  assert.deepEqual(collectUnsplashLeakFailures("/repo/dist/client/assets/app.js", image), []);
  assert.deepEqual(collectUnsplashLeakFailures("/repo/dist/server/worker.js", "https://api.unsplash.com/search/photos Authorization: Client-ID"), []);
  const clientLeak = collectUnsplashLeakFailures("/repo/dist/client/assets/app.js", "https://api.unsplash.com/search/photos");
  assert.ok(clientLeak.some((failure) => failure.includes("api\\.unsplash\\.com\\/search\\/photos")));
  const retired = readServerKeyFromEnvFile();
  assert.equal(typeof retired, "string");
  assert.equal(retired.length, 43);
  assert.equal(
    createHash("sha256").update(retired).digest("hex"),
    "b154eedf0629ded229de62e02ab8b50448e110b42728f6c1afba5141fdad7ded",
  );
  const leaked = collectUnsplashLeakFailures("/repo/ios/App/App/public/assets/app.js", `token=${retired}`);
  assert.equal(leaked.length, 1);
  assert.match(leaked[0], /unsplash access key fingerprint/);
  assert.equal(leaked[0].includes(retired), false);
  const serverLeak = collectUnsplashLeakFailures("/repo/dist/server/index.js", retired);
  assert.equal(serverLeak.length, 1);
  assert.equal(serverLeak[0].includes(retired), false);
  assert.equal(textHasRetiredUnsplashAccessKey("a".repeat(43)), false);
});

try {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.info("PASS", name);
    } catch (error) {
      failed += 1;
      console.error("FAIL", name);
      console.error(error);
    }
  }
  if (failed) process.exitCode = 1;
} finally {
  unsplashSearchClient.getAccessToken = savedClient.getAccessToken;
  unsplashSearchClient.fetchImpl = savedClient.fetchImpl;
  unsplashSearchClient.resolveUrl = savedClient.resolveUrl;
  restoreEnv("UNSPLASH_ACCESS_KEY");
  restoreEnv("VITE_UNSPLASH_ACCESS_KEY");
}
